import pandas as pd
import numpy as np
import numpy as np
import pingouin as pg
import itertools
import io
import html
import json
import traceback
import os
import stripe
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Body, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from ydata_profiling import ProfileReport
from scipy import stats
import statsmodels.api as sm
from statsmodels.stats.diagnostic import het_breuschpagan
from dotenv import load_dotenv

import uuid
from typing import Optional

# --- Konfiguracja ---
load_dotenv()
app = FastAPI()

# Zabezpieczenie przed wyciekiem pamięci - prosty magazyn w pamięci
session_storage = {}

stripe.api_key = os.getenv("STRIPE_API_KEY")
# Umożliwia dostęp z localhost, domeny produkcyjnej oraz wszystkich domen testowych (preview) na Vercel
allow_origin_regex = r"https?://(localhost:3000|analiza-danych-python.*\.vercel\.app)"

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ten URL będzie używany tylko jako fallback, jeśli nagłówek Origin nie będzie dostępny
FALLBACK_FRONTEND_URL = "https://analiza-danych-python.vercel.app"

# --- Endpointy API ---

@app.post("/api/parse-preview")
async def parse_preview(file: UploadFile = File(...)):
    try:
        content = await file.read()
        
        try:
            df_full = pd.read_csv(io.BytesIO(content), encoding='utf-8')
        except UnicodeDecodeError:
            df_full = pd.read_csv(io.BytesIO(content), encoding='latin1')

        missing_values_series = df_full.isnull().sum()
        columns_with_missing_data = missing_values_series[missing_values_series > 0].index.tolist()
        has_missing_data = len(columns_with_missing_data) > 0
        
        missing_value_locations = []
        detection_method_explanation = None

        if has_missing_data:
            detection_method_explanation = (
                "Braki danych wykrywamy poprzez analizę każdej komórki w przesłanym pliku. "
                "Za brak danych uznajemy puste komórki oraz standardowe znaczniki takie jak 'NA', 'N/A', 'NaN' czy 'null'. "
                "System automatycznie skanuje cały zbiór w poszukiwaniu tych wartości, aby zapewnić integralność analizy."
            )

            # Znajdź indeksy wszystkich brakujących wartości
            null_coords = np.where(pd.isnull(df_full))
            
            # Przetwórz do 5 pierwszych znalezionych lokalizacji
            for i in range(min(5, len(null_coords[0]))):
                row_idx = null_coords[0][i]
                col_idx = null_coords[1][i]
                col_name = df_full.columns[col_idx]
                # Dodajemy 2 do indeksu wiersza: +1 bo indeksy są od 0, +1 za wiersz nagłówka w pliku CSV
                location_str = f"Wiersz {row_idx + 2}, kolumna '{col_name}'"
                missing_value_locations.append(location_str)

        df_preview = df_full.head(5)
        df_preview_filled = df_preview.astype(object).where(pd.notnull(df_preview), None)
        
        response_content = {
            "columns": df_preview_filled.columns.tolist(), 
            "preview_data": df_preview_filled.values.tolist(),
            "missing_data_info": {
                "has_missing_data": has_missing_data,
                "columns_with_missing_data": columns_with_missing_data,
                "missing_value_locations": missing_value_locations,
                "detection_method": detection_method_explanation
            }
        }
        return JSONResponse(content=response_content)
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Błąd przetwarzania pliku CSV: {e}", "trace": traceback.format_exc()})

@app.post("/api/create-payment-session")
async def create_payment_session(
    request: Request,
    file: UploadFile = File(...), 
    variable_types_json: str = Form(...),
    missing_data_strategy: str = Form(...)
):
    try:
        # Dynamiczne określanie URL frontendu na podstawie nagłówka Origin
        origin = request.headers.get('origin')
        if not origin or "analiza-danych-python" not in origin:
            # Fallback na stałą wartość, jeśli nagłówek Origin jest nieobecny lub nieprawidłowy
            origin = FALLBACK_FRONTEND_URL

        file_content = await file.read()
        variable_types = json.loads(variable_types_json)

        # Utwórz sesję płatności w Stripe
        session = stripe.checkout.Session.create(
            payment_method_types=['blik', 'p24'],
            line_items=[{
                'price_data': {
                    'currency': 'pln',
                    'product_data': {
                        'name': 'Automatyczna Analiza Danych Statystycznych',
                    },
                    'unit_amount': 800,  # 8.00 PLN w groszach
                },
                'quantity': 1,
            }],
            mode='payment',
            # Użyj dynamicznego URL frontendu i przekaż ID sesji Stripe
            success_url=f"{origin}/sukces?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{origin}/anulowano",
        )
        
        # Zapisz dane w pamięci podręcznej, używając ID sesji Stripe jako klucza
        session_storage[session.id] = {
            "file_content": file_content,
            "variable_types": variable_types,
            "missing_data_strategy": missing_data_strategy
        }

        return JSONResponse({'id': session.id, 'url': session.url})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Błąd Stripe lub przetwarzania danych: {str(e)}")

def handle_missing_data(df: pd.DataFrame, strategy: str):
    if strategy == 'none':
        if df.isnull().values.any():
            raise ValueError("Wybrano opcję 'brak braków danych', ale plik zawiera brakujące wartości. Proszę oczyścić dane lub wybrać inną strategię.")
        info = "Sprawdzono - plik nie zawiera brakujących wartości."
        return df, info
    elif strategy == 'delete_cols':
        cols_before = set(df.columns)
        df_cleaned = df.dropna(axis=1)
        cols_after = set(df_cleaned.columns)
        deleted_cols = ", ".join(list(cols_before - cols_after))
        info = f"Usunięto kolumny z brakującymi wartościami: {deleted_cols}." if deleted_cols else "Nie znaleziono kolumn z brakującymi wartościami do usunięcia."
        return df_cleaned, info
    elif strategy == 'delete_rows':
        rows_before = len(df)
        df_cleaned = df.dropna(axis=0)
        rows_after = len(df_cleaned)
        deleted_rows_count = rows_before - rows_after
        info = f"Usunięto {deleted_rows_count} wierszy zawierających brakujące wartości." if deleted_rows_count > 0 else "Nie znaleziono wierszy z brakującymi wartościami do usunięcia."
        return df_cleaned, info
    elif strategy == 'impute':
        imputed_cols = []
        for col in df.columns:
            if df[col].isnull().any():
                if pd.api.types.is_numeric_dtype(df[col]):
                    median_val = df[col].median()
                    df.loc[:, col] = df[col].fillna(median_val)
                    imputed_cols.append(f"{col} (medianą: {median_val:.2f})")
                else:
                    mode_val = df[col].mode()[0]
                    df.loc[:, col] = df[col].fillna(mode_val)
                    imputed_cols.append(f"{col} (dominantą: {mode_val})")
        info = f"Uzupełniono brakujące wartości w kolumnach: {', '.join(imputed_cols)}." if imputed_cols else "Nie znaleziono brakujących wartości do uzupełnienia."
        return df, info
    else:
        raise ValueError("Nieznana strategia obsługi braków danych.")

def run_academic_tests_and_build_table(df: pd.DataFrame, variable_types: dict, missing_data_info: str) -> str:
    all_results = []
    variable_types_lower = {k: v.lower() for k, v in variable_types.items()}
    
    continuous_cols = [col for col, type_ in variable_types_lower.items() if type_ == 'ciągła' and col in df.columns]
    binary_cols = [col for col, type_ in variable_types_lower.items() if type_ == 'binarna' and col in df.columns]
    categorical_cols = [col for col, type_ in variable_types_lower.items() if type_ in ['nominalna', 'porządkowa', 'kategoryczna', 'binarna'] and col in df.columns]

    for col in df.columns:
        if col in continuous_cols or col in binary_cols:
             df[col] = pd.to_numeric(df[col], errors='coerce')

    # --- SCENARIUSZE TESTÓW ---
    # (Logika testów pozostaje taka sama jak poprzednio, ale działa na DataFrame po obsłudze braków danych)
    # --- SCENARIUSZ 1: Ciągła vs. Binarna ---
    for cont_col, bin_col in itertools.product(continuous_cols, binary_cols):
        try:
            cleaned_data = df[[cont_col, bin_col]].dropna()
            if cleaned_data[bin_col].nunique() != 2:
                all_results.append({"Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": "N/A", "p-value": "N/A", "Siła Efektu": "N/A", "Uwagi": f"Kolumna '{bin_col}' nie jest binarna.", "assumptions_met": False, "is_robust": False})
                continue
            if len(cleaned_data) < 10: continue

            normality_result = pg.normality(data=cleaned_data, dv=cont_col, group=bin_col)
            is_normal = normality_result['pval'].min() > 0.05
            levene_result = pg.homoscedasticity(data=cleaned_data, dv=cont_col, group=bin_col)
            is_homoscedastic = levene_result['pval'].iloc[0] > 0.05
            assumptions_met_ttest = is_normal and is_homoscedastic
            
            # Poprawiona logika T-Testu: podział na grupy
            unique_vals = cleaned_data[bin_col].unique()
            group1 = cleaned_data[cont_col][cleaned_data[bin_col] == unique_vals[0]]
            group2 = cleaned_data[cont_col][cleaned_data[bin_col] == unique_vals[1]]

            test_name = "Test T-Studenta" if is_homoscedastic else "Test T (Welch)"
            ttest_result = pg.ttest(group1, group2, correction=not is_homoscedastic)
            p_value_ttest = ttest_result['p-val'].iloc[0]
            cohen_d = ttest_result['cohen-d'].iloc[0]
            
            uwagi_ttest = []
            if not is_normal: uwagi_ttest.append("niespełnione założenie o normalności rozkładu")
            if not is_homoscedastic: uwagi_ttest.append("niespełnione założenie o równości wariancji")
            if not uwagi_ttest: uwagi_ttest.append("Założenia spełnione.")

            all_results.append({"Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": test_name, "p-value": p_value_ttest, "Siła Efektu": f"d Cohena = {cohen_d:.3f}", "Uwagi": "; ".join(uwagi_ttest), "assumptions_met": assumptions_met_ttest, "is_robust": False})

            if not is_normal:
                group1 = cleaned_data[cont_col][cleaned_data[bin_col] == cleaned_data[bin_col].unique()[0]]
                group2 = cleaned_data[cont_col][cleaned_data[bin_col] == cleaned_data[bin_col].unique()[1]]
                mwu_result = pg.mwu(group1, group2)
                p_value_mwu = mwu_result['p-val'].iloc[0]
                effect_size_mwu = mwu_result['RBC'].iloc[0]
                all_results.append({"Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": "Test U Manna-Whitneya (odporny)", "p-value": p_value_mwu, "Siła Efektu": f"RBC = {effect_size_mwu:.3f}", "Uwagi": "Użyty z powodu braku normalności rozkładu.", "assumptions_met": True, "is_robust": True})
        except Exception as e:
            all_results.append({"Zmienne": f"{cont_col} vs. {bin_col}", "Typ Analizy": "Ciągła vs. Binarna", "Użyty Test": "N/A", "p-value": float('inf'), "Siła Efektu": "N/A", "Uwagi": f"Błąd: {html.escape(str(e))}", "assumptions_met": False, "is_robust": False})

    # --- SCENARIUSZ 2: Ciągła vs. Ciągła ---
    for col1, col2 in itertools.combinations(continuous_cols, 2):
        try:
            cleaned_data = df[[col1, col2]].dropna()
            if len(cleaned_data) < 10: continue

            X = sm.add_constant(cleaned_data[col1])
            model = sm.OLS(cleaned_data[col2], X).fit()
            p_value_reg = model.pvalues.iloc[1]
            r_squared = model.rsquared

            _, p_shapiro = stats.shapiro(model.resid)
            is_resid_normal = p_shapiro > 0.05
            _, p_bp, _, _ = het_breuschpagan(model.resid, model.model.exog)
            is_homoscedastic = p_bp > 0.05
            
            uwagi_reg = []
            if not is_resid_normal: uwagi_reg.append(f"niespełnione założenie o normalności reszt (p={p_shapiro:.3f})")
            if not is_homoscedastic: uwagi_reg.append(f"niespełnione założenie o homoskedastyczności (p={p_bp:.3f})")
            if not uwagi_reg: uwagi_reg.append("Założenia (normalność reszt, homoskedastyczność) spełnione.")
            
            all_results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Ciągła vs. Ciągła", "Użyty Test": "Regresja Liniowa", "p-value": p_value_reg, "Siła Efektu": f"R-kwadrat = {r_squared:.3f}", "Uwagi": "; ".join(uwagi_reg), "assumptions_met": is_resid_normal and is_homoscedastic, "is_robust": False})

            spearman_corr = pg.corr(cleaned_data[col1], cleaned_data[col2], method='spearman')
            p_value_spearman = spearman_corr['p-val'].iloc[0]
            rho = spearman_corr['r'].iloc[0]
            all_results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Ciągła vs. Ciągła", "Użyty Test": "Korelacja Spearmana (odporna)", "p-value": p_value_spearman, "Siła Efektu": f"rho = {rho:.3f}", "Uwagi": "Test nieparametryczny, odporny na brak normalności i nieliniowe zależności monotoniczne.", "assumptions_met": True, "is_robust": True})

        except Exception as e:
            all_results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Ciągła vs. Ciągła", "Użyty Test": "N/A", "p-value": float('inf'), "Siła Efektu": "N/A", "Uwagi": f"Błąd: {html.escape(str(e))}", "assumptions_met": False, "is_robust": False})

    # --- SCENARIUSZ 3: Kategoryczna vs. Kategoryczna ---
    for col1, col2 in itertools.combinations(categorical_cols, 2):
        if col1 == col2: continue
        try:
            cleaned_data = df[[col1, col2]].dropna()
            if cleaned_data.empty or cleaned_data.nunique().min() < 2: continue

            chi2_result = pg.chi2_independence(data=cleaned_data, x=col1, y=col2)
            # Na podstawie logów debugowania, kolejność w krotce jest inna niż w dokumentacji.
            # stats_df jest trzecim elementem, a expected pierwszym.
            expected = chi2_result[0]
            stats_df = chi2_result[2]
            
            p_value_chi2 = stats_df.loc[stats_df['test'] == 'pearson', 'pval'].iloc[0]
            cramer_v = stats_df.loc[stats_df['test'] == 'pearson', 'cramer'].iloc[0]
            assumption_met_chi2 = expected.min().min() >= 5
            uwagi_chi2 = "Założenie o liczebnościach oczekiwanych (>=5) spełnione." if assumption_met_chi2 else "Niespełnione założenie o liczebnościach oczekiwanych (>=5)."
            
            all_results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Kategoryczna vs. Kategoryczna", "Użyty Test": "Test Chi-kwadrat", "p-value": p_value_chi2, "Siła Efektu": f"V Craméra = {cramer_v:.3f}", "Uwagi": uwagi_chi2, "assumptions_met": assumption_met_chi2, "is_robust": False})

            if not assumption_met_chi2:
                crosstab = pd.crosstab(cleaned_data[col1], cleaned_data[col2])
                if crosstab.shape == (2, 2):
                    _, p_fisher = stats.fisher_exact(crosstab)
                    all_results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Kategoryczna vs. Kategoryczna", "Użyty Test": "Dokładny test Fishera (odporny)", "p-value": p_fisher, "Siła Efektu": "N/A", "Uwagi": "Użyty z powodu małych liczebności oczekiwanych w tabeli 2x2.", "assumptions_met": True, "is_robust": True})
        except Exception as e:
            all_results.append({"Zmienne": f"{col1} vs. {col2}", "Typ Analizy": "Kategoryczna vs. Kategoryczna", "Użyty Test": "N/A", "p-value": float('inf'), "Siła Efektu": "N/A", "Uwagi": f"Błąd: {html.escape(str(e))}", "assumptions_met": False, "is_robust": False})

    # --- Budowanie tabel HTML ---
    if not all_results:
        return "<h2>Brak wyników testów statystycznych</h2><p>Nie znaleziono odpowiednich par zmiennych do analizy po zastosowaniu wybranej strategii obsługi braków danych.</p>"

    all_results.sort(key=lambda x: (x["Zmienne"], x["is_robust"]))
    
    num_tests = len(all_results)
    bonferroni_threshold = 0.05 / num_tests if num_tests > 0 else 0.05

    header1 = "<h2>Część 2: Pełne Wyniki Testów Statystycznych</h2>"
    desc1 = f"<p>Poniższa tabela przedstawia pełne wyniki analizy zależności między zmiennymi. W przypadku niespełnienia założeń testu parametrycznego, w osobnym wierszu przedstawiono wynik jego nieparametrycznego (odpornego) odpowiednika. Wynik został podświetlony na czerwono, gdy test wykazał istotną statystycznie zależność (p < {bonferroni_threshold:.4f}) po zastosowaniu korekty Bonferroniego i w warunkach, które pozwalają uznać go za wiarygodny.</p>"
    
    info_box_style = "margin: 15px 0; padding: 10px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px;"
    
    missing_data_html = f"<div style='{info_box_style}'><strong>Obsługa braków danych:</strong> {html.escape(missing_data_info)}</div>"

    html_table = header1 + missing_data_html + desc1 + "<table border='1' style='width:100%; border-collapse: collapse; text-align: left; font-size: 14px;'><thead><tr style='background-color: #f0f0f0;'><th>Zmienne</th><th>Typ Analizy</th><th>Użyty Test</th><th>p-value</th><th>Siła Efektu</th><th>Uwagi</th></tr></thead><tbody>"
    
    significant_results = []
    last_zmienne = None
    for i, res in enumerate(all_results):
        is_significant_and_valid = False
        p_val = res.get("p-value", float('inf'))
        
        if (res.get("assumptions_met", False) and p_val < bonferroni_threshold):
            is_significant_and_valid = True
            significant_results.append(res)
        
        style = "background-color: #ffcccc;" if is_significant_and_valid else ""
        
        current_zmienne = res.get('Zmienne', '')
        if last_zmienne is not None and current_zmienne != last_zmienne:
            style += " border-top: 2px solid #ccc;"
        last_zmienne = current_zmienne

        p_val_str = f"{p_val:.4f}" if isinstance(p_val, float) and p_val != float('inf') else str(p_val)
        html_table += f"<tr style='{style}'><td>{res.get('Zmienne', 'N/A')}</td><td>{res.get('Typ Analizy', 'N/A')}</td><td>{res.get('Użyty Test', 'N/A')}</td><td>{p_val_str}</td><td>{res.get('Siła Efektu', 'N/A')}</td><td>{res.get('Uwagi', 'N/A')}</td></tr>"
    html_table += "</tbody></table>"

    if significant_results:
        header2 = "<h2>Podsumowanie: Istotne Wyniki po Korekcie Bonferroniego</h2>"
        desc2 = f"<p>Poniższa tabela zawiera wyłącznie te zależności, które okazały się istotne statystycznie po zastosowaniu rygorystycznej korekty na wielokrotne porównania (p < {bonferroni_threshold:.4f}). Korekta Bonferroniego minimalizuje ryzyko fałszywych odkryć, dając większą pewność co do wiarygodności wyników. Wyniki te z największym prawdopodobieństwem wskazują na rzeczywistą, wartą dalszej analizy zależność między zmiennymi.</p>"
        html_table += "<br>" + header2 + desc2 + "<table border='1' style='width:100%; border-collapse: collapse; text-align: left; font-size: 14px;'><thead><tr style='background-color: #e6ffec;'><th>Zmienne</th><th>Typ Analizy</th><th>Użyty Test</th><th>p-value</th><th>Siła Efektu</th><th>Uwagi</th></tr></thead><tbody>"
        significant_results.sort(key=lambda x: x["p-value"])
        for res in significant_results:
            p_val_str = f"{res.get('p-value', 'N/A'):.4f}"
            html_table += f"<tr><td>{res.get('Zmienne', 'N/A')}</td><td>{res.get('Typ Analizy', 'N/A')}</td><td>{res.get('Użyty Test', 'N/A')}</td><td>{p_val_str}</td><td>{res.get('Siła Efektu', 'N/A')}</td><td>{res.get('Uwagi', 'N/A')}</td></tr>"
        html_table += "</tbody></table>"

    # Sekcja z interpretacją i formularzem
    interpretation_section = f"""
    <div style='{info_box_style}'>
        <h3>Jak Interpretować Wyniki i Co Dalej?</h3>
        <p><strong>Korelacja to nie Kauzacja (Związek to nie Przyczynowość)</strong></p>
        <p>Wyniki w tabeli wskazują na istnienie <strong>statystycznej zależności</strong> między zmiennymi. Oznacza to, że gdy wartość jednej zmiennej się zmienia, wartość drugiej również ma tendencję do zmiany w określony sposób. Należy jednak bezwzględnie pamiętać, że <strong>nie dowodzi to związku przyczynowo-skutkowego</strong>.</p>
        <p>Prezentowane analizy są doskonałym punktem wyjścia do dalszej eksploracji i formułowania hipotez, ale nie stanowią ostatecznego dowodu na przyczynowość.</p>
        
        <h4>Chcesz zbadać te zależności głębiej?</h4>
        <p>Jeśli chcesz zrozumieć, które czynniki mają realny wpływ na inne, przewidywać wartości lub odkryć bardziej złożone wzorce, konieczne jest zastosowanie zaawansowanych modeli statystycznych lub algorytmów sztucznej inteligencji.</p>
        <p>Nasz zespół specjalizuje się w budowie takich rozwiązań. Skontaktuj się z nami, aby otrzymać niezobowiązującą wycenę dalszej analizy (koszt od 100 zł).</p>
        
        <form action="https://formspree.io/f/xzzypzyb" method="POST" style="margin-top: 15px;">
            <div style="margin-bottom: 10px;">
                <label for="email">Twój email:</label><br>
                <input type="email" id="email" name="email" required style="width: 300px; padding: 5px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label for="message">Wiadomość:</label><br>
                <textarea id="message" name="message" required style="width: 100%; min-height: 80px; padding: 5px;"></textarea>
            </div>
            <button type="submit" style="padding: 10px 15px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Wyślij</button>
        </form>
    </div>
    """
    html_table += interpretation_section
    return html_table

@app.post("/api/generate-report", response_class=HTMLResponse)
async def generate_report(session_id: Optional[str] = Body(None, embed=True)):
    if not session_id:
        raise HTTPException(status_code=400, detail="Brak ID sesji.")
    
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Klucz API Stripe nie jest skonfigurowany.")

    try:
        # Weryfikacja płatności
        checkout_session = stripe.checkout.Session.retrieve(session_id)
        if checkout_session.payment_status != "paid":
            raise HTTPException(status_code=402, detail="Płatność nie została zakończona.")
    except Exception as e:
        raise HTTPException(status_code=402, detail=f"Nieprawidłowa sesja płatności: {e}")

    # Pobranie danych z pamięci podręcznej
    session_data = session_storage.get(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Nie znaleziono danych sesji. Być może sesja wygasła. Spróbuj ponownie.")

    try:
        file_content = session_data["file_content"]
        variable_types = session_data["variable_types"]
        missing_data_strategy = session_data["missing_data_strategy"]
        
        try:
            df_original = pd.read_csv(io.BytesIO(file_content), encoding='utf-8')
        except UnicodeDecodeError:
            df_original = pd.read_csv(io.BytesIO(file_content), encoding='latin1')
        except Exception as e:
            return HTMLResponse(content=f"<h1>Błąd</h1><p>Plik CSV jest uszkodzony lub nieprawidłowy. Błąd: {e}</p>", status_code=400)

        try:
            df, missing_data_info = handle_missing_data(df_original.copy(), missing_data_strategy)
        except ValueError as e:
            return HTMLResponse(content=f"<h1>Błąd Walidacji Danych</h1><p>{e}</p>", status_code=400)

        profile = ProfileReport(df, title="Część 1: Automatyczny Raport Opisowy (Rozszerzony)")
        report1_html = profile.to_html()
        
        report2_html = run_academic_tests_and_build_table(df.copy(), variable_types, missing_data_info) 
        
        final_html = report1_html + "<br><hr style='border: 2px solid #007bff;'>" + report2_html
        return HTMLResponse(content=final_html)

    finally:
        # Upewnij się, że dane sesji są usuwane po użyciu, aby zwolnić pamięć
        if session_id in session_storage:
            del session_storage[session_id]

@app.get("/api/test")
def smoke_test():
    return {"status": "ok", "message": "Backend na Render działa!"}