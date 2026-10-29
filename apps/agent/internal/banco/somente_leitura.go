package banco

import (
	"errors"
	"strings"
	"unicode"
)

// ErrNaoSomenteLeitura indica SQL recusado antes de chegar ao banco.
var ErrNaoSomenteLeitura = errors.New("apenas consultas de leitura (SELECT/WITH) são permitidas")

// Palavras que não podem aparecer fora de strings, comentários e identificadores entre aspas.
// INTO bloqueia SELECT ... INTO (cria tabela/arquivo); COMMIT/ROLLBACK impedem sair da transação.
var palavrasProibidas = map[string]bool{
	"INSERT": true, "UPDATE": true, "DELETE": true, "MERGE": true, "UPSERT": true, "REPLACE": true,
	"DROP": true, "ALTER": true, "CREATE": true, "TRUNCATE": true, "RENAME": true,
	"GRANT": true, "REVOKE": true, "EXEC": true, "EXECUTE": true, "CALL": true, "DO": true,
	"COMMIT": true, "ROLLBACK": true, "SAVEPOINT": true, "BEGIN": true,
	"INTO": true, "COPY": true, "LOCK": true, "HANDLER": true, "LOAD": true,
	"OPENROWSET": true, "OPENQUERY": true, "OPENDATASOURCE": true, "BULK": true,
	"SHUTDOWN": true, "KILL": true, "DBCC": true, "RECONFIGURE": true,
}

// dialeto descreve como cada banco delimita strings e comentários. O validador precisa
// enxergar exatamente o que o banco enxerga: qualquer divergência permitiria esconder um
// comando dentro do que o validador acha que é uma string.
type dialeto struct {
	barraEscapa        bool // MySQL: \' dentro de '...' e "..."
	comentarioHash     bool // MySQL: # até o fim da linha
	comentarioAninhado bool // PostgreSQL e SQL Server: /* /* */ */
	colchetes          bool // SQL Server: [identificador]
	dollarQuote        bool // PostgreSQL: $$...$$ e $tag$...$tag$
	stringE            bool // PostgreSQL: E'...' aceita \'
}

var dialetos = map[string]dialeto{
	TipoPostgres:  {comentarioAninhado: true, dollarQuote: true, stringE: true},
	TipoMySQL:     {barraEscapa: true, comentarioHash: true},
	TipoSQLServer: {comentarioAninhado: true, colchetes: true},
}

// ValidarSomenteLeitura é uma barreira léxica a mais, não a única: a consulta também
// roda numa transação que é sempre desfeita (somente leitura no PostgreSQL e MySQL), e o
// recomendado continua sendo um usuário de banco só com permissão de leitura.
//
// Exige um único comando começando por SELECT ou WITH e sem palavras de escrita.
func ValidarSomenteLeitura(sql, tipoBanco string) error {
	d, ok := dialetos[tipoBanco]
	if !ok {
		return errors.New("tipo de banco desconhecido: " + tipoBanco)
	}
	palavras, comandos, err := tokenizar(sql, d)
	if err != nil {
		return err
	}
	if len(palavras) == 0 {
		return errors.New("SQL vazio")
	}
	if comandos > 1 {
		return errors.New("envie um único comando por consulta")
	}
	if p := palavras[0]; p != "SELECT" && p != "WITH" {
		return ErrNaoSomenteLeitura
	}
	for _, p := range palavras {
		if palavrasProibidas[p] {
			return errors.New(ErrNaoSomenteLeitura.Error() + ": encontrado " + p)
		}
	}
	return nil
}

// tokenizar devolve as palavras (maiúsculas) fora de literais e comentários e o número
// de comandos separados por ';'. Na dúvida, erra para o lado de recusar.
func tokenizar(sql string, d dialeto) (palavras []string, comandos int, err error) {
	r := []rune(sql)
	n := len(r)
	temConteudo := false
	fimUltimaPalavra := -1

	for i := 0; i < n; {
		c := r[i]
		switch {
		case c == '-' && i+1 < n && r[i+1] == '-',
			c == '#' && d.comentarioHash:
			for i < n && r[i] != '\n' {
				i++
			}

		case c == '/' && i+1 < n && r[i+1] == '*':
			if i+2 < n && r[i+2] == '!' && d.comentarioHash {
				// MySQL executa o conteúdo de /*! ... */.
				return nil, 0, errors.New("comentários executáveis /*! */ não são permitidos")
			}
			if i, err = fecharComentario(r, i, d.comentarioAninhado); err != nil {
				return nil, 0, err
			}

		case c == '\'':
			escapa := d.barraEscapa ||
				(d.stringE && fimUltimaPalavra == i && palavras[len(palavras)-1] == "E")
			if i, err = fecharAspas(r, i, '\'', escapa); err != nil {
				return nil, 0, err
			}
			temConteudo = true

		case c == '"' || c == '`':
			if i, err = fecharAspas(r, i, c, d.barraEscapa && c == '"'); err != nil {
				return nil, 0, err
			}
			temConteudo = true

		case c == '[' && d.colchetes:
			if i, err = fecharAspas(r, i, ']', false); err != nil {
				return nil, 0, err
			}
			temConteudo = true

		case c == '$' && d.dollarQuote:
			j := i + 1
			if j < n && unicode.IsDigit(r[j]) { // parâmetro $1
				for j < n && unicode.IsDigit(r[j]) {
					j++
				}
				i = j
				temConteudo = true
				break
			}
			for j < n && (unicode.IsLetter(r[j]) || unicode.IsDigit(r[j]) || r[j] == '_') {
				j++
			}
			if j < n && r[j] == '$' {
				tag := string(r[i : j+1])
				resto := string(r[j+1:])
				fim := strings.Index(resto, tag)
				if fim < 0 {
					return nil, 0, errors.New("string " + tag + " sem fechamento")
				}
				i = j + 1 + len([]rune(resto[:fim])) + len([]rune(tag))
			} else {
				i++
			}
			temConteudo = true

		case c == ';':
			if temConteudo {
				comandos++
			}
			temConteudo = false
			i++

		case unicode.IsLetter(c) || c == '_':
			j := i
			for j < n && ehLetraIdent(r[j]) {
				j++
			}
			palavras = append(palavras, strings.ToUpper(string(r[i:j])))
			fimUltimaPalavra = j
			temConteudo = true
			i = j

		default:
			if !unicode.IsSpace(c) {
				temConteudo = true
			}
			i++
		}
	}
	if temConteudo {
		comandos++
	}
	return palavras, comandos, nil
}

// fecharAspas avança até o delimitador de fechamento. Delimitador duplicado (” "" ]]) é
// escape em todos os bancos; barra invertida só quando o dialeto/prefixo diz que é.
func fecharAspas(r []rune, i int, fecha rune, barraEscapa bool) (int, error) {
	for j := i + 1; j < len(r); j++ {
		if barraEscapa && r[j] == '\\' {
			j++
			continue
		}
		if r[j] == fecha {
			if j+1 < len(r) && r[j+1] == fecha {
				j++
				continue
			}
			return j + 1, nil
		}
	}
	return 0, errors.New("texto entre aspas ou colchetes sem fechamento")
}

func fecharComentario(r []rune, i int, aninhado bool) (int, error) {
	nivel := 0
	for j := i; j+1 < len(r); j++ {
		switch {
		case r[j] == '/' && r[j+1] == '*' && (aninhado || nivel == 0):
			nivel++
			j++
		case r[j] == '*' && r[j+1] == '/':
			nivel--
			j++
			if nivel == 0 {
				return j + 1, nil
			}
		}
	}
	return 0, errors.New("comentário /* sem fechamento")
}

func ehLetraIdent(c rune) bool {
	return unicode.IsLetter(c) || unicode.IsDigit(c) || c == '_' || c == '$'
}
