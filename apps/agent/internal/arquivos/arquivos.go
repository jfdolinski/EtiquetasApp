// Package arquivos lê planilhas (csv, xls, xlsx) de uma pasta deste computador: a pasta é uma
// conexão como os bancos. Só lê, só essas extensões e só dentro da pasta configurada.
package arquivos

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/pbnjay/grate"
	"github.com/pbnjay/grate/commonxl"
	_ "github.com/pbnjay/grate/xls"
	"github.com/xuri/excelize/v2"
	"golang.org/x/text/encoding/charmap"

	"etiquetas/agente/internal/protocolo"
)

const (
	tamanhoMaximo      = 100 << 20
	maximoArquivos     = 2000
	limiteLinhasMaximo = 100_000
	arquivosEmCache    = 8
)

// falha é um erro para mostrar ao usuário (pasta inexistente, arquivo aberto…).
func falha(formato string, args ...any) error {
	return fmt.Errorf(formato, args...)
}

func extensaoAceita(nome string) bool {
	switch strings.ToLower(filepath.Ext(nome)) {
	case ".csv", ".xls", ".xlsx", ".xlsm":
		// "~$..." é o arquivo de trava que o Excel cria enquanto a planilha está aberta.
		return !strings.HasPrefix(filepath.Base(nome), "~$")
	}
	return false
}

// Listar devolve as planilhas da pasta e das subpastas, com caminho relativo (separador "/").
func Listar(pasta string) ([]protocolo.Arquivo, error) {
	info, err := os.Stat(pasta)
	if err != nil || !info.IsDir() {
		return nil, falha("pasta não encontrada neste computador: %s", pasta)
	}
	lista := []protocolo.Arquivo{}
	err = filepath.WalkDir(pasta, func(caminho string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir // subpasta sem permissão não derruba a lista
			}
			return nil
		}
		if d.IsDir() || !extensaoAceita(d.Name()) {
			return nil
		}
		i, err := d.Info()
		if err != nil {
			return nil
		}
		relativo, err := filepath.Rel(pasta, caminho)
		if err != nil {
			return nil
		}
		lista = append(lista, protocolo.Arquivo{
			Caminho:      filepath.ToSlash(relativo),
			Tamanho:      i.Size(),
			ModificadoEm: i.ModTime().UTC().Format(time.RFC3339),
		})
		if len(lista) >= maximoArquivos {
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return nil, falha("não foi possível ler a pasta: %v", err)
	}
	sort.Slice(lista, func(a, b int) bool { return strings.ToLower(lista[a].Caminho) < strings.ToLower(lista[b].Caminho) })
	return lista, nil
}

// resolver garante que o arquivo pedido está dentro da pasta, mesmo seguindo atalhos simbólicos.
func resolver(pasta, relativo string) (string, error) {
	local := filepath.FromSlash(relativo)
	if !filepath.IsLocal(local) || !extensaoAceita(local) {
		return "", falha("arquivo fora da pasta da conexão ou de tipo não aceito: %s", relativo)
	}
	base, err := filepath.EvalSymlinks(pasta)
	if err != nil {
		return "", falha("pasta não encontrada neste computador: %s", pasta)
	}
	real, err := filepath.EvalSymlinks(filepath.Join(pasta, local))
	if err != nil {
		return "", falha("arquivo não encontrado na pasta: %s", relativo)
	}
	dentro, err := filepath.Rel(base, real)
	if err != nil || !filepath.IsLocal(dentro) {
		return "", falha("arquivo fora da pasta da conexão: %s", relativo)
	}
	return real, nil
}

// planilha é um arquivo já lido: abas na ordem e linhas brutas (a primeira preenchida é o título).
type planilha struct {
	modificado time.Time
	tamanho    int64
	usado      time.Time
	abas       []string
	linhas     map[string][][]any
}

// Leitor guarda os últimos arquivos lidos: a busca por código abre o mesmo arquivo a cada
// etiqueta, e reler só compensa quando ele mudou.
type Leitor struct {
	mu    sync.Mutex
	cache map[string]*planilha
}

func NovoLeitor() *Leitor {
	return &Leitor{cache: map[string]*planilha{}}
}

func (l *Leitor) abrir(caminho string) (*planilha, error) {
	info, err := os.Stat(caminho)
	if err != nil {
		return nil, falha("arquivo não encontrado: %s", filepath.Base(caminho))
	}
	if info.Size() > tamanhoMaximo {
		return nil, falha("%s passa de %d MB", filepath.Base(caminho), tamanhoMaximo>>20)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if p, ok := l.cache[caminho]; ok && p.modificado.Equal(info.ModTime()) && p.tamanho == info.Size() {
		p.usado = time.Now()
		return p, nil
	}
	p, err := lerArquivo(caminho)
	if err != nil {
		return nil, err
	}
	p.modificado, p.tamanho, p.usado = info.ModTime(), info.Size(), time.Now()
	if len(l.cache) >= arquivosEmCache {
		var antigo string
		for k, v := range l.cache {
			if antigo == "" || v.usado.Before(l.cache[antigo].usado) {
				antigo = k
			}
		}
		delete(l.cache, antigo)
	}
	l.cache[caminho] = p
	return p, nil
}

// Ler devolve o título e as linhas da aba pedida (a primeira, se não informada), filtradas por Termo.
func (l *Leitor) Ler(pasta string, req protocolo.LerArquivo) (*protocolo.ResultadoArquivo, error) {
	inicio := time.Now()
	caminho, err := resolver(pasta, req.Caminho)
	if err != nil {
		return nil, err
	}
	p, err := l.abrir(caminho)
	if err != nil {
		return nil, err
	}
	aba := req.Aba
	if aba == "" && len(p.abas) > 0 {
		aba = p.abas[0]
	}
	linhas, ok := p.linhas[aba]
	if !ok {
		return nil, falha("a aba %q não existe em %s", aba, req.Caminho)
	}
	limite := req.LimiteLinhas
	if limite <= 0 || limite > limiteLinhasMaximo {
		limite = limiteLinhasMaximo
	}
	saida, truncado := filtrar(linhas, req.Termo, limite)
	return &protocolo.ResultadoArquivo{Abas: p.abas, Aba: aba, Linhas: saida, Truncado: truncado, DuracaoMs: time.Since(inicio).Milliseconds()}, nil
}

func preenchida(l []any) bool {
	for _, v := range l {
		if v != nil && strings.TrimSpace(texto(v)) != "" {
			return true
		}
	}
	return false
}

func texto(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

var soDigitos = regexp.MustCompile(`^\d+$`)

// codigo normaliza como mesmoCodigo em packages/shared/src/avulsa.ts: sem zeros à esquerda.
func codigo(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if soDigitos.MatchString(s) {
		if t := strings.TrimLeft(s, "0"); t != "" {
			return t
		}
		return "0"
	}
	return s
}

// filtrar segue filtrarTabela de packages/shared/src/planilhas.ts: código exato em alguma
// coluna; senão, quem contém o texto. A primeira linha preenchida (título) sempre vai junto.
func filtrar(linhas [][]any, termo string, limite int) ([][]any, bool) {
	titulo := -1
	for i, l := range linhas {
		if preenchida(l) {
			titulo = i
			break
		}
	}
	if titulo < 0 {
		return [][]any{}, false
	}
	dados := linhas[titulo+1:]
	termo = strings.TrimSpace(termo)
	if termo != "" {
		dados = selecionar(dados, termo)
	}
	saida := make([][]any, 0, min(len(dados), limite)+1)
	saida = append(saida, linhas[titulo])
	truncado := false
	for _, l := range dados {
		if !preenchida(l) {
			continue
		}
		if len(saida) > limite {
			truncado = true
			break
		}
		saida = append(saida, l)
	}
	return saida, truncado
}

func selecionar(dados [][]any, termo string) [][]any {
	onde := func(aceita func(string) bool) [][]any {
		var r [][]any
		for _, l := range dados {
			for _, v := range l {
				if v != nil && aceita(texto(v)) {
					r = append(r, l)
					break
				}
			}
		}
		return r
	}
	if strings.ContainsAny(termo, "0123456789") && !strings.ContainsAny(termo, " \t") {
		alvo := codigo(termo)
		if r := onde(func(s string) bool { return codigo(s) == alvo }); len(r) > 0 {
			return r
		}
	}
	minusculo := strings.ToLower(termo)
	return onde(func(s string) bool { return strings.Contains(strings.ToLower(s), minusculo) })
}

func lerArquivo(caminho string) (p *planilha, err error) {
	// As bibliotecas de Excel podem entrar em pânico com arquivo corrompido.
	defer func() {
		if r := recover(); r != nil {
			p, err = nil, falha("não foi possível ler %s: arquivo corrompido ou em formato desconhecido", filepath.Base(caminho))
		}
	}()
	switch strings.ToLower(path.Ext(filepath.ToSlash(caminho))) {
	case ".csv":
		return lerCsv(caminho)
	case ".xls":
		return lerXls(caminho)
	default:
		return lerXlsx(caminho)
	}
}

func erroAoAbrir(caminho string, err error) error {
	return falha("não foi possível abrir %s (%v). Se ele estiver aberto com exclusividade, feche-o", filepath.Base(caminho), err)
}

func lerCsv(caminho string) (*planilha, error) {
	dados, err := os.ReadFile(caminho)
	if err != nil {
		return nil, erroAoAbrir(caminho, err)
	}
	dados = bytes.TrimPrefix(dados, []byte{0xEF, 0xBB, 0xBF})
	if !utf8.Valid(dados) { // o Excel salva CSV em Windows-1252
		if dados, err = charmap.Windows1252.NewDecoder().Bytes(dados); err != nil {
			return nil, falha("codificação não reconhecida em %s", filepath.Base(caminho))
		}
	}
	primeira, _, _ := bytes.Cut(dados, []byte{'\n'})
	separador, maior := ',', bytes.Count(primeira, []byte{','})
	for _, s := range []rune{';', '\t'} {
		if n := bytes.Count(primeira, []byte(string(s))); n > maior {
			separador, maior = s, n
		}
	}
	r := csv.NewReader(bytes.NewReader(dados))
	r.Comma, r.FieldsPerRecord, r.LazyQuotes = separador, -1, true
	linhas := [][]any{}
	for {
		campos, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, falha("CSV inválido em %s: %v", filepath.Base(caminho), err)
		}
		linha := make([]any, len(campos))
		for i, c := range campos {
			linha[i] = c // texto: "0789" continua com o zero
		}
		linhas = append(linhas, linha)
	}
	nome := filepath.Base(caminho)
	return &planilha{abas: []string{nome}, linhas: map[string][][]any{nome: linhas}}, nil
}

var (
	numeroCanonico = regexp.MustCompile(`^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$`)
)

// celula converte o valor do Excel: número vira número, exceto o que perderia dígitos ou zeros.
func celula(bruto string) any {
	if bruto == "" {
		return nil
	}
	digitos := strings.TrimPrefix(bruto, "-")
	if numeroCanonico.MatchString(bruto) && (len(digitos) <= 15 || strings.ContainsAny(digitos, ".eE")) {
		if f, err := strconv.ParseFloat(bruto, 64); err == nil {
			return f
		}
	}
	return bruto
}

// formatoCelula diz o que o formato de uma célula numérica significa, com cache por estilo.
type formatoCelula struct {
	f     *excelize.File
	porId map[int]int
}

const (
	formatoNumero = iota
	formatoData
	formatoTexto
)

// Partes literais de um formato ("R$", \y, [Red]) não contam para reconhecer datas.
var literaisDoFormato = regexp.MustCompile(`"[^"]*"|\\.|\[[^\]]*\]`)

func (c *formatoCelula) de(aba string, coluna, linha int) int {
	celula, err := excelize.CoordinatesToCellName(coluna+1, linha+1)
	if err != nil {
		return formatoNumero
	}
	id, err := c.f.GetCellStyle(aba, celula)
	if err != nil {
		return formatoNumero
	}
	if t, ok := c.porId[id]; ok {
		return t
	}
	t := formatoNumero
	if e, err := c.f.GetStyle(id); err == nil {
		switch {
		case e.NumFmt == 49:
			t = formatoTexto
		case e.NumFmt >= 14 && e.NumFmt <= 22, e.NumFmt >= 45 && e.NumFmt <= 47:
			t = formatoData
		case e.CustomNumFmt != nil:
			if strings.ContainsAny(strings.ToLower(literaisDoFormato.ReplaceAllString(*e.CustomNumFmt, "")), "dmyaehs") {
				t = formatoData
			}
		}
	}
	c.porId[id] = t
	return t
}

func lerXlsx(caminho string) (*planilha, error) {
	f, err := excelize.OpenFile(caminho)
	if err != nil {
		return nil, erroAoAbrir(caminho, err)
	}
	defer f.Close()
	formatos := &formatoCelula{f: f, porId: map[int]int{}}
	p := &planilha{linhas: map[string][][]any{}}
	for _, aba := range f.GetSheetList() {
		// Valor bruto: "R$ 4,99" formatado seria texto, e a data é um número de série.
		brutas, err := f.GetRows(aba, excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, falha("não foi possível ler a aba %s: %v", aba, err)
		}
		linhas := make([][]any, len(brutas))
		for i, b := range brutas {
			linha := make([]any, len(b))
			for j, v := range b {
				linha[j] = celula(v)
				n, ehNumero := linha[j].(float64)
				if !ehNumero {
					continue
				}
				switch formatos.de(aba, j, i) {
				case formatoTexto:
					linha[j] = v // código digitado em célula de texto continua texto
				case formatoData:
					if d, err := excelize.ExcelDateToTime(n, false); err == nil {
						linha[j] = formatarData(d)
					}
				}
			}
			linhas[i] = linha
		}
		p.abas = append(p.abas, aba)
		p.linhas[aba] = linhas
	}
	return p, nil
}

func formatarData(d time.Time) string {
	if d.Hour() == 0 && d.Minute() == 0 && d.Second() == 0 {
		return d.Format("2006-01-02")
	}
	return d.Format("2006-01-02 15:04:05")
}

func lerXls(caminho string) (*planilha, error) {
	// A biblioteca não fecha o arquivo quando não reconhece o formato: confere a assinatura antes.
	if err := conferirOle2(caminho); err != nil {
		return nil, err
	}
	wb, err := grate.Open(caminho)
	if err != nil {
		return nil, erroAoAbrir(caminho, err)
	}
	defer wb.Close()
	nomes, err := wb.List()
	if err != nil {
		return nil, erroAoAbrir(caminho, err)
	}
	p := &planilha{linhas: map[string][][]any{}}
	for _, nome := range nomes {
		colecao, err := wb.Get(nome)
		if err != nil {
			return nil, falha("não foi possível ler a aba %s: %v", nome, err)
		}
		// Os valores crus, como no xlsx: o texto viria com a formatação da célula.
		aba, ok := colecao.(*commonxl.Sheet)
		if !ok {
			return nil, falha("formato inesperado na aba %s", nome)
		}
		linhas := make([][]any, 0, len(aba.Rows))
		for _, row := range aba.Rows {
			linha := make([]any, len(row))
			for i := range row {
				switch v := row[i].Value().(type) {
				case time.Time:
					linha[i] = formatarData(v)
				case int64:
					linha[i] = celula(strconv.FormatInt(v, 10))
				case string:
					if linha[i] = v; v == "" {
						linha[i] = nil
					}
				case nil:
				default:
					linha[i] = v
				}
			}
			linhas = append(linhas, linha)
		}
		p.abas = append(p.abas, nome)
		p.linhas[nome] = linhas
	}
	return p, nil
}

func conferirOle2(caminho string) error {
	f, err := os.Open(caminho)
	if err != nil {
		return erroAoAbrir(caminho, err)
	}
	defer f.Close()
	assinatura := make([]byte, 8)
	if _, err := io.ReadFull(f, assinatura); err != nil || !bytes.Equal(assinatura, []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}) {
		return falha("%s não é um arquivo .xls válido", filepath.Base(caminho))
	}
	return nil
}
