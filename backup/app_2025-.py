import pandas as pd
import pingouin as pg
import itertools
import io
import html
import json
import traceback
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from ydata_profiling import ProfileReport

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# === KROK 1: ENDPOINT PODGLĄDU (Z POPRAWKĄ 'NaN') ===
@app.post("/api/parse-preview")
async def parse_preview(file: UploadFile = File(...)):
    try:
        content = await file.read()
        
        try:
            df_preview = pd.read_csv(io.BytesIO(content), nrows=10, encoding='utf-8')
        except UnicodeDecodeError:
            df_preview = pd.read_csv(io.BytesIO(content), nrows=10, encoding='latin1')

        df_preview_filled = df_preview.astype(object).where(pd.notnull(df_preview), None)

        columns = df_preview_filled.columns.tolist()
        preview_data = df_preview_filled.values.tolist()
        
        return JSONResponse(content={
            "columns": columns,
            "preview_data": preview_data
        })
        
    except Exception as e:
        error_content = {"error": f"Nie udało się przetworzyć pliku CSV. Upewnij się, że to poprawny plik. Błąd: {e}"}
        response = JSONResponse(status_code=400, content=error_content)
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response

def run_academic_tests_and_build_table(df: pd.DataFrame, variable_types: dict) -> str:
    """
    Generuje drugą część raportu: testy wnioskujące na podstawie
    typów zmiennych zdefiniowanych przez użytkownika.
    """
    results = []

    # === KROK 0: CZYSZCZENIE DANYCH i UJEDNOLICENIE TYPÓW ===
    variable_types_lower = {k: v.lower() for k, v in variable_types.items()}
    numeric_cols_to_clean = [col for col, type_ in variable_types_lower.items() if type_ in ['ciągła', 'porządkowa']]
    
    for col in numeric_cols_to_clean:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # === KROK 1: KATEGORYZACJA KOLUMN ===
    continuous_cols = [col for col, type_ in variable_types_lower.items() if type_ == 'ciągła']
    binary_cols = [col for col, type_ in variable_types_lower.items() if type_ == 'binarna']
    nominal_cols = [col for col, type_ in variable_types_lower.items() if type_ == 'nominalna']
    ordinal_cols = [col for col, type_ in variable_types_lower.items() if type_ == 'porządkowa']
    categorical_cols_for_chi2 = nominal_cols + binary_cols

    # --- SCENARIUSZ 1: Ciągła vs. Binarna (Test T-Studenta) ---
    for cont_col, bin_col in itertools.product(continuous_cols, binary_cols):
        try:
            cleaned_data = df[[cont_col, bin_col]].dropna()
            if cleaned_data[bin_col].nunique() != 2:
                results.append({ "Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": "N/A", "Status": "Nie wykonano", "p-value": "N/A", "Siła Efektu": "N/A", "Uwagi": f"Kolumna '{bin_col}' nie jest binarna (ma mniej lub więcej niż 2 unikalne wartości)." })
                continue

            normality_result = pg.normality(data=cleaned_data, dv=cont_col, group=bin_col)
            is_normal = normality_result['pval'].min() > 0.05
            if not is_normal:
                results.append({ "Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": "Test T-Studenta", "Status": "Nie wykonano", "p-value": "N/A", "Siła Efektu": "N/A", "Uwagi": "Założenie o normalności rozkładu nie zostało spełnione." })
                continue
            
            levene_result = pg.homoscedasticity(data=cleaned_data, dv=cont_col, group=bin_col)
            is_homoscedastic = levene_result['pval'].iloc[0] > 0.05
            
            correction = not is_homoscedastic
            test_name = "Test T-Studenta" if is_homoscedastic else "Test T (Welch)"
            test_result = pg.ttest(x=cleaned_data[cont_col], y=cleaned_data[bin_col], correction=correction)
            p_value = test_result['pval'].iloc[0]
            cohen_d = test_result['cohen-d'].iloc[0]
            
            results.append({ "Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": test_name, "Status": "Wykonano", "p-value": f"{p_value:.4f}", "Siła Efektu": f"d Cohena = {cohen_d:.3f}", "Uwagi": f"Założenia spełnione (Normalność: Tak, Równość Wariancji: {'Tak' if is_homoscedastic else 'Nie'})." })
        except Exception as e:
            error_type = type(e).__name__
            error_message = str(e)
            full_traceback = traceback.format_exc()
            print(f"Błąd w teście Ciągła vs. Binarna ({cont_col} vs. {bin_col}):\n{full_traceback}")
            results.append({ "Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": "N/A", "Status": f"Błąd: {error_type}", "p-value": "N/A", "Siła Efektu": "N/A", "Uwagi": f"Szczegóły: {html.escape(error_message)}<pre>{html.escape(full_traceback)}</pre>"})

    # --- SCENARIUSZ 2: Ciągła vs. Ciągła (Regresja Liniowa) ---
    for col1, col2 in itertools.combinations(continuous_cols, 2):
        try:
            cleaned_data = df[[col1, col2]].dropna()
            if len(cleaned_data) < 3: continue
            lm_result = pg.linear_regression(cleaned_data[col1], cleaned_data[col2])
            p_value = lm_result.loc[1, 'pval']
            r_squared = lm_result['r2'].iloc[0]
            results.append({ "Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Ciągła vs. Ciągła", "Użyty Test": "Regresja Liniowa", "Status": "Wykonano", "p-value": f"{p_value:.4f}", "Siła Efektu": f"R-kwadrat = {r_squared:.3f}", "Uwagi": "Założenia regresji nie zostały sprawdzone (MVP)." })
        except Exception as e:
            error_type = type(e).__name__
            error_message = str(e)
            full_traceback = traceback.format_exc()
            print(f"Błąd w teście Ciągła vs. Ciągła ({col1} vs. {col2}):\n{full_traceback}")
            results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Ciągła vs. Ciągła", "Użyty Test": "N/A", "Status": f"Błąd: {error_type}", "p-value": "N/A", "Siła Efektu": "N/A", "Uwagi": f"Szczegóły: {html.escape(error_message)}<pre>{html.escape(full_traceback)}</pre>"})
            
    # --- SCENARIUSZ 3: Kategoryczna vs. Kategoryczna (Chi-kwadrat) ---
    for col1, col2 in itertools.combinations(categorical_cols_for_chi2, 2):
        try:
            cleaned_data = df[[col1, col2]].dropna()
            if cleaned_data.empty: continue
            
            chi2_result = pg.chi2_independence(data=cleaned_data, x=col1, y=col2)
            stats_df = chi2_result[2]
            p_value = stats_df.loc[stats_df['test'] == 'pearson', 'pval'].iloc[0]
            cramer_v = stats_df.loc[stats_df['test'] == 'pearson', 'cramer'].iloc[0]
            
            expected = chi2_result[1]
            assumption_met = expected.min().min() >= 5
            if assumption_met:
                results.append({ "Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Kategoryczna vs. Kategoryczna", "Użyty Test": "Test Chi-kwadrat", "Status": "Wykonano", "p-value": f"{p_value:.4f}", "Siła Efektu": f"V Craméra = {cramer_v:.3f}", "Uwagi": "Założenia spełnione (liczebności oczekiwane > 5)." })
            else:
                results.append({ "Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Kategoryczna vs. Kategoryczna", "Użyty Test": "Test Chi-kwadrat", "Status": "Nie wykonano", "p-value": "N/A", "Siła Efektu": "N/A", "Uwagi": "Założenie o liczebnościach oczekiwanych (> 5) nie zostało spełnione." })
        except Exception as e:
            error_type = type(e).__name__
            error_message = str(e)
            full_traceback = traceback.format_exc()
            print(f"Błąd w teście Kategoryczna vs. Kategoryczna ({col1} vs. {col2}):\n{full_traceback}")
            results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Kategoryczna vs. Kategoryczna", "Użyty Test": "N/A", "Status": f"Błąd: {error_type}", "p-value": "N/A", "Siła Efektu": "N/A", "Uwagi": f"Szczegóły: {html.escape(error_message)}<pre>{html.escape(full_traceback)}</pre>"})

    # --- NOWY SCENARIUSZ 4: Ciągła vs. Porządkowa (Korelacja Spearmana) ---
    for cont_col, ord_col in itertools.product(continuous_cols, ordinal_cols):
        try:
            cleaned_data = df[[cont_col, ord_col]].dropna()
            if cleaned_data.empty: continue

            spearman_result = pg.corr(cleaned_data[cont_col], cleaned_data[ord_col], method='spearman')
            p_value = spearman_result['pval'].iloc[0]
            rho = spearman_result['r'].iloc[0]
            results.append({
                "Zmienne": f"{cont_col} vs. {ord_col}",
                "Typ Analizy": "Ciągła vs. Porządkowa",
                "Użyty Test": "Korelacja rang Spearmana",
                "Status": "Wykonano",
                "p-value": f"{p_value:.4f}",
                "Siła Efektu": f"rho Spearmana = {rho:.3f}",
                "Uwagi": "Test nieparametryczny, odpowiedni dla zmiennych porządkowych."
            })
        except Exception as e:
            error_type = type(e).__name__
            error_message = str(e)
            full_traceback = traceback.format_exc()
            print(f"Błąd w teście Ciągła vs. Porządkowa ({cont_col} vs. {ord_col}):\n{full_traceback}")
            results.append({
                "Zmienne": f"{cont_col} vs. {ord_col}",
                "Typ Analizy": "Ciągła vs. Porządkowa",
                "Użyty Test": "N/A",
                "Status": f"Błąd: {error_type}",
                "p-value": "N/A",
                "Siła Efektu": "N/A",
                "Uwagi": f"Szczegóły: {html.escape(error_message)}<pre>{html.escape(full_traceback)}</pre>"
            })

    # --- Budowanie tabeli HTML ---
    if not results:
        return "<h2>Brak wyników testów statystycznych</h2><p>Nie znaleziono odpowiednich par zmiennych do analizy lub wszystkie zmienne zostały pominięte.</p>"
    
    results.sort(key=lambda x: (x["Status"] != "Wykonano", float(x["p-value"]) if x["p-value"] != "N/A" else 999))
    
    html_table = "<h2>Część 2: Wyniki Testów Wnioskujących (Istotności)</h2>"
    html_table += "<p>Automatyczna analiza zależności między zmiennymi na podstawie Twoich definicji. Istotne wyniki (p<0.05) są podświetlone.</p>"
    html_table += "<table border='1' style='width:100%; border-collapse: collapse; text-align: left; font-size: 14px;'><thead><tr style='background-color: #f0f0f0;'><th>Zmienne</th><th>Typ Analizy</th><th>Użyty Test</th><th>Status</th><th>p-value</th><th>Siła Efektu</th><th>Uwagi</th></tr></thead><tbody>"
    for res in results:
        p_val_str = res.get("p-value", "N/A")
        is_significant = False
        try:
            is_significant = p_val_str != "N/A" and float(p_val_str) < 0.05
        except (ValueError, TypeError):
            pass

        style = ""
        if res["Status"] != "Wykonano":
            style = "background-color: #fff0f0;"
        elif is_significant:
            style = "background-color: #e6ffec; font-weight: bold;"

        html_table += f"<tr style='{style}'>"
        for key in ["Zmienne", "Typ Analizy", "Użyty Test", "Status", "p-value", "Siła Efektu", "Uwagi"]:
            html_table += f"<td>{res.get(key, 'N/A')}</td>"
        html_table += "</tr>"
    html_table += "</tbody></table>"
    html_table += "<div style='margin-top: 15px; padding: 10px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px;'>"
    html_table += "<strong>Uwaga o wielokrotnych porównaniach:</strong> Przeprowadzenie wielu testów statystycznych zwiększa szansę na uzyskanie fałszywie istotnych wyników (błędy I rodzaju). W praktyce akademickiej stosuje się korekty (np. Bonferroniego), które nie zostały tu zaimplementowane (MVP)."
    html_table += "</div>"
    
    return html_table

# === GŁÓWNY ENDPOINT (ZMODYFIKOWANY) ===
@app.post("/api/generate-report", response_class=HTMLResponse)
async def generate_report(file: UploadFile = File(...), variable_types_json: str = Form(...)):
    
    file_content = await file.read()
    
    variable_types = json.loads(variable_types_json)
    
    try:
        df = pd.read_csv(io.BytesIO(file_content))
    except Exception as e:
        return HTMLResponse(content=f"<h1>Błąd</h1><p>Plik CSV jest uszkodzony. Błąd: {e}</p>", status_code=400)

    profile = ProfileReport(df, 
                            title="Część 1: Automatyczny Raport Opisowy (Podstawowy)", 
                            minimal=True, 
                            correlations=None, 
                            interactions=None, 
                            missing_diagrams=None)
    report1_html = profile.to_html()
    
    report2_html = run_academic_tests_and_build_table(df, variable_types) 
    
    final_html = report1_html + "<br><hr style='border: 2px solid #007bff;'>" + report2_html
    
    return HTMLResponse(content=final_html)

@app.get("/api/test")
def smoke_test():
    return {"status": "ok", "message": "Backend na Render działa!"}