package cliente

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCadastrarEListarImpressoras(t *testing.T) {
	var recebida NovaImpressora
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != caminhoImpressoras {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer agt_ok" {
			http.Error(w, `{"message":"Token do agente inválido ou revogado."}`, http.StatusUnauthorized)
			return
		}
		switch r.Method {
		case http.MethodPost:
			_ = json.NewDecoder(r.Body).Decode(&recebida)
			if recebida.Nome == "" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"message":["O nome deve ter ao menos 2 caracteres."]}`))
				return
			}
			_, _ = w.Write([]byte(`{"id":"i1","nome":"Zebra","linguagem":"ZPL","dpi":203,"metodo":"SISTEMA","endereco":"ZDesigner","ativo":true,"jaExistia":false}`))
		default:
			_, _ = w.Write([]byte(`[{"id":"i1","nome":"Zebra","linguagem":"ZPL","dpi":203,"metodo":"SISTEMA","endereco":"ZDesigner","ativo":true}]`))
		}
	}))
	defer srv.Close()
	ctx := context.Background()

	r, err := CadastrarImpressora(ctx, srv.URL, "agt_ok", NovaImpressora{Nome: "Zebra", Linguagem: "ZPL", DPI: 203, Metodo: "SISTEMA", Endereco: "ZDesigner"})
	if err != nil || r.ID != "i1" || recebida.Endereco != "ZDesigner" {
		t.Fatalf("cadastro: %+v %v (enviado %+v)", r, err, recebida)
	}
	lista, err := ListarImpressoras(ctx, srv.URL, "agt_ok")
	if err != nil || len(lista) != 1 || lista[0].Metodo != "SISTEMA" {
		t.Fatalf("lista: %+v %v", lista, err)
	}
	if _, err := CadastrarImpressora(ctx, srv.URL, "agt_ok", NovaImpressora{}); err == nil || err.Error() != "O nome deve ter ao menos 2 caracteres." {
		t.Errorf("erro de validação deveria vir com a mensagem do servidor: %v", err)
	}
	if _, err := ListarImpressoras(ctx, srv.URL, "agt_revogado"); !errors.Is(err, ErrPrecisaAtivar) {
		t.Errorf("token recusado deveria pedir nova ativação: %v", err)
	}
}
