package banco

import (
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

// Maior inteiro que o JavaScript representa sem perda (2^53 - 1).
const maiorInteiroSeguro = 1<<53 - 1

// converterValor deixa o valor lido do driver em um formato JSON estável, igual para os
// três bancos: datas em ISO 8601, decimais e inteiros grandes como texto, binário em base64.
func converterValor(v any, tipoColuna string) any {
	switch x := v.(type) {
	case nil:
		return nil
	case bool, string, float32:
		return x
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return fmt.Sprint(x) // JSON não tem NaN/Infinity
		}
		return x
	case int64:
		if x > maiorInteiroSeguro || x < -maiorInteiroSeguro {
			return fmt.Sprint(x)
		}
		return x
	case int, int32, int16, int8, uint8, uint16, uint32:
		return x
	case uint64:
		if x > maiorInteiroSeguro {
			return fmt.Sprint(x)
		}
		return x
	case time.Time:
		if strings.EqualFold(tipoColuna, "DATE") {
			return x.Format(time.DateOnly)
		}
		return x.Format(time.RFC3339Nano)
	case []byte:
		if strings.EqualFold(tipoColuna, "UNIQUEIDENTIFIER") && len(x) == 16 {
			return uuidSQLServer(x)
		}
		if utf8.Valid(x) {
			return string(x)
		}
		return base64.StdEncoding.EncodeToString(x)
	case [16]byte: // UUID do pgx
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case driver.Valuer:
		valor, err := x.Value()
		if err != nil {
			return fmt.Sprint(x)
		}
		return converterValor(valor, tipoColuna)
	case json.Marshaler:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		// Mapas e listas (json/jsonb, arrays do PostgreSQL) já são serializáveis.
		if _, err := json.Marshal(x); err == nil {
			return x
		}
		return fmt.Sprint(x)
	}
}

// uuidSQLServer: o SQL Server grava os três primeiros grupos em little-endian.
func uuidSQLServer(b []byte) string {
	return fmt.Sprintf("%02X%02X%02X%02X-%02X%02X-%02X%02X-%X-%X",
		b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6], b[8:10], b[10:16])
}

// normalizarParametro: números chegam do JSON como json.Number (Decoder.UseNumber).
func normalizarParametro(v any) any {
	n, ok := v.(json.Number)
	if !ok {
		return v
	}
	if i, err := n.Int64(); err == nil {
		return i
	}
	if f, err := n.Float64(); err == nil {
		return f
	}
	return n.String()
}
