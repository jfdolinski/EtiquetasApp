package arquivos

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"etiquetas/agente/internal/protocolo"
)

func escrever(t *testing.T, pasta, nome, conteudo string) {
	t.Helper()
	caminho := filepath.Join(pasta, filepath.FromSlash(nome))
	if err := os.MkdirAll(filepath.Dir(caminho), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(caminho, []byte(conteudo), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListarSoPlanilhas(t *testing.T) {
	pasta := t.TempDir()
	for _, n := range []string{"b.xlsx", "A.CSV", "sub/c.xls", "nota.txt", "~$b.xlsx", "programa.exe"} {
		escrever(t, pasta, n, "x")
	}
	lista, err := Listar(pasta)
	if err != nil {
		t.Fatal(err)
	}
	var nomes []string
	for _, a := range lista {
		nomes = append(nomes, a.Caminho)
	}
	if !reflect.DeepEqual(nomes, []string{"A.CSV", "b.xlsx", "sub/c.xls"}) {
		t.Fatalf("lista: %v", nomes)
	}
	if _, err := Listar(filepath.Join(pasta, "nao-existe")); err == nil {
		t.Fatal("pasta inexistente deveria falhar")
	}
}

func TestNaoSaiDaPasta(t *testing.T) {
	fora := t.TempDir()
	escrever(t, fora, "segredo.csv", "a\n1\n")
	pasta := filepath.Join(fora, "pasta")
	escrever(t, pasta, "ok.csv", "a\n1\n")
	escrever(t, pasta, "senhas.txt", "x")
	l := NovoLeitor()
	for _, c := range []string{"../segredo.csv", "sub/../../segredo.csv", filepath.Join(fora, "segredo.csv"), "senhas.txt", ""} {
		if _, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: c}); err == nil {
			t.Errorf("deveria recusar %q", c)
		}
	}
	if os.Symlink(filepath.Join(fora, "segredo.csv"), filepath.Join(pasta, "atalho.csv")) == nil { // no Windows exige privilégio
		if _, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: "atalho.csv"}); err == nil {
			t.Error("atalho para fora deveria ser recusado")
		}
	}
	if _, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: "ok.csv"}); err != nil {
		t.Fatal(err)
	}
}

func TestCsvWindows1252PontoEVirgula(t *testing.T) {
	pasta := t.TempDir()
	escrever(t, pasta, "p.csv", "c\xf3digo;descri\xe7\xe3o;pre\xe7o\r\n0789;\"Arroz; 5kg\";4,99\r\n")
	r, err := NovoLeitor().Ler(pasta, protocolo.LerArquivo{Caminho: "p.csv"})
	if err != nil {
		t.Fatal(err)
	}
	esperado := [][]any{{"código", "descrição", "preço"}, {"0789", "Arroz; 5kg", "4,99"}}
	if !reflect.DeepEqual(r.Linhas, esperado) {
		t.Fatalf("linhas: %#v", r.Linhas)
	}
}

func xlsxDeTeste(t *testing.T, caminho string) {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	f.SetSheetName("Sheet1", "Preços")
	if _, err := f.NewSheet("Outra"); err != nil {
		t.Fatal(err)
	}
	moeda := `"R$" #,##0.00`
	sMoeda, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &moeda})
	sData, _ := f.NewStyle(&excelize.Style{NumFmt: 14})
	f.SetSheetRow("Preços", "A1", &[]any{"EAN", "Descrição", "Preço", "Validade"})
	f.SetSheetRow("Preços", "A2", &[]any{"0789", "Arroz", 4.99, 46387})
	f.SetSheetRow("Preços", "A3", &[]any{7891000100103, "Feijão", 8.5, 46388})
	f.SetCellStyle("Preços", "C2", "C3", sMoeda)
	f.SetCellStyle("Preços", "D2", "D3", sData)
	f.SetSheetRow("Outra", "A1", &[]any{"x"})
	f.SetSheetRow("Outra", "A2", &[]any{"y"})
	if err := f.SaveAs(caminho); err != nil {
		t.Fatal(err)
	}
}

// Formatos reais do Excel em português: data com nome do mês, "yyyy" literal, texto e moeda.
func TestXlsxFormatosDeCelula(t *testing.T) {
	pasta := t.TempDir()
	f := excelize.NewFile()
	defer f.Close()
	moeda, mes, literal := `"R$" #,##0.00`, "dd-mmm-yy", `dd/mm/\y\y\y\y`
	estilo := func(formato *string) int {
		id, err := f.NewStyle(&excelize.Style{CustomNumFmt: formato})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	sTexto, _ := f.NewStyle(&excelize.Style{NumFmt: 49})
	f.SetSheetRow("Sheet1", "A1", &[]any{"a", "b", "c", "d", "e"})
	f.SetCellValue("Sheet1", "A2", 4.99)
	f.SetCellStyle("Sheet1", "A2", "A2", estilo(&moeda))
	f.SetCellValue("Sheet1", "B2", 46387)
	f.SetCellStyle("Sheet1", "B2", "B2", estilo(&mes))
	f.SetCellValue("Sheet1", "C2", 46387)
	f.SetCellStyle("Sheet1", "C2", "C2", estilo(&literal))
	f.SetCellStr("Sheet1", "D2", "7891000200204")
	f.SetCellStyle("Sheet1", "D2", "D2", sTexto)
	f.SetCellValue("Sheet1", "E2", 12)
	if err := f.SaveAs(filepath.Join(pasta, "f.xlsx")); err != nil {
		t.Fatal(err)
	}
	r, err := NovoLeitor().Ler(pasta, protocolo.LerArquivo{Caminho: "f.xlsx"})
	if err != nil {
		t.Fatal(err)
	}
	esperado := []any{4.99, "2026-12-31", "2026-12-31", "7891000200204", 12.0}
	if !reflect.DeepEqual(r.Linhas[1], esperado) {
		t.Fatalf("linha: %#v", r.Linhas[1])
	}
}

func TestXlsxNumerosDatasEAbas(t *testing.T) {
	pasta := t.TempDir()
	xlsxDeTeste(t, filepath.Join(pasta, "p.xlsx"))
	l := NovoLeitor()
	r, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: "p.xlsx"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.Abas, []string{"Preços", "Outra"}) || r.Aba != "Preços" {
		t.Fatalf("abas: %v aba %q", r.Abas, r.Aba)
	}
	esperado := [][]any{
		{"EAN", "Descrição", "Preço", "Validade"},
		{"0789", "Arroz", 4.99, "2026-12-31"},
		{7891000100103.0, "Feijão", 8.5, "2027-01-01"},
	}
	if !reflect.DeepEqual(r.Linhas, esperado) {
		t.Fatalf("linhas: %#v", r.Linhas)
	}
	outra, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: "p.xlsx", Aba: "Outra"})
	if err != nil || len(outra.Linhas) != 2 {
		t.Fatalf("aba Outra: %v %v", outra, err)
	}
	if _, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: "p.xlsx", Aba: "Nenhuma"}); err == nil {
		t.Fatal("aba inexistente deveria falhar")
	}
}

// produtos.xls foi salvo pelo Excel de verdade (formato binário 97-2003).
func TestXlsDoExcel(t *testing.T) {
	r, err := NovoLeitor().Ler("testdata", protocolo.LerArquivo{Caminho: "produtos.xls"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Linhas) != 3 || r.Abas[0] != "Preços" {
		t.Fatalf("resultado: %v %#v", r.Abas, r.Linhas)
	}
	if !reflect.DeepEqual(r.Linhas[0], []any{"EAN", "Descrição", "Preço", "Validade"}) {
		t.Fatalf("título: %#v", r.Linhas[0])
	}
	if r.Linhas[1][0] != "0789" || r.Linhas[1][1] != "Arroz acentuação" || r.Linhas[1][2] != 4.99 || r.Linhas[1][3] != "2026-12-31" {
		t.Fatalf("linha 1: %#v", r.Linhas[1])
	}
	if r.Linhas[2][0] != 7891000100103.0 {
		t.Fatalf("EAN numérico: %#v", r.Linhas[2][0])
	}
}

func TestBusca(t *testing.T) {
	linhas := [][]any{{nil}, {"ean", "nome"}, {"0789", "Arroz"}, {7891.0, "Arroz integral"}, {"555", "Feijão 789"}, {nil, nil}}
	nomes := func(termo string, limite int) ([]string, bool) {
		r, truncado := filtrar(linhas, termo, limite)
		if r[0][0] != "ean" {
			t.Fatalf("título sumiu: %#v", r)
		}
		var n []string
		for _, l := range r[1:] {
			n = append(n, l[1].(string))
		}
		return n, truncado
	}
	if n, _ := nomes("789", 10); !reflect.DeepEqual(n, []string{"Arroz"}) {
		t.Errorf("código exato sem zeros: %v", n)
	}
	if n, _ := nomes("arroz", 10); !reflect.DeepEqual(n, []string{"Arroz", "Arroz integral"}) {
		t.Errorf("texto contido: %v", n)
	}
	if n, _ := nomes("nada", 10); len(n) != 0 {
		t.Errorf("sem resultado: %v", n)
	}
	if n, truncado := nomes("", 2); len(n) != 2 || !truncado {
		t.Errorf("limite: %v %v", n, truncado)
	}
}

func TestCacheReleQuandoMuda(t *testing.T) {
	pasta := t.TempDir()
	escrever(t, pasta, "p.csv", "a\n1\n")
	l := NovoLeitor()
	if _, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: "p.csv"}); err != nil {
		t.Fatal(err)
	}
	escrever(t, pasta, "p.csv", "a\n1\n2\n")
	os.Chtimes(filepath.Join(pasta, "p.csv"), time.Now(), time.Now().Add(time.Minute))
	r, err := l.Ler(pasta, protocolo.LerArquivo{Caminho: "p.csv"})
	if err != nil || len(r.Linhas) != 3 {
		t.Fatalf("não releu: %v %v", r, err)
	}
}

func TestArquivoCorrompidoNaoDerruba(t *testing.T) {
	pasta := t.TempDir()
	escrever(t, pasta, "ruim.xlsx", "não é excel")
	escrever(t, pasta, "ruim.xls", strings.Repeat("\x00\x01", 1000))
	for _, n := range []string{"ruim.xlsx", "ruim.xls"} {
		if _, err := NovoLeitor().Ler(pasta, protocolo.LerArquivo{Caminho: n}); err == nil {
			t.Errorf("%s deveria falhar", n)
		}
	}
}
