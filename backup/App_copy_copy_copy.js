import React, { useState, useEffect } from 'react';

// === Endpointy na backendzie ===
const API_BASE_URL = "http://127.0.0.1:8000/api";
const PREVIEW_URL = `${API_BASE_URL}/parse-preview`;
const PAYMENT_URL = `${API_BASE_URL}/create-payment-session`;
const REPORT_URL = `${API_BASE_URL}/generate-report`;

// === Komponent do wyboru typu zmiennej ===
function VariableTypeSelector({ columnName, onChange }) {
  return (
    <select onChange={(e) => onChange(columnName, e.target.value)} style={{ width: '100%' }}>
      <option value="pomiń">Pomiń (np. ID, Tekst)</option>
      <option value="ciągła">Ciągła (np. Wiek, Przychód)</option>
      <option value="binarna">Binarna (2 grupy, np. Płeć)</option>
      <option value="nominalna">Kategoryczna (3+ grup, np. Miasto)</option>
      <option value="porzadkowa">Porządkowa (kolejność)</option>
    </select>
  );
}

// === Główna aplikacja ===
function App() {
  // --- Stany Aplikacji ---
  const [originalFile, setOriginalFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [variableTypes, setVariableTypes] = useState({});
  const [missingDataStrategy, setMissingDataStrategy] = useState('');
  const [missingDataInfo, setMissingDataInfo] = useState({ has_missing_data: false, columns_with_missing_data: [] });

  const [reportHtml, setReportHtml] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState('idle');

  // --- Efekt do obsługi powrotu ze Stripe ---
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const sessionId = query.get('session_id');

    if (sessionId && window.location.pathname.includes('/sukces')) {
      setPaymentStatus('success');
      const fileDataUrl = localStorage.getItem('fileDataUrl');
      const storedTypes = localStorage.getItem('variableTypes');
      const storedStrategy = localStorage.getItem('missingDataStrategy');

      if (fileDataUrl && storedTypes && storedStrategy) {
        fetchReport(sessionId, JSON.parse(storedTypes), storedStrategy);
      } else {
        setError("Nie znaleziono danych sesji po powrocie z płatności. Proszę spróbować ponownie od początku, wgrywając plik.");
      }
    }

    if (window.location.pathname.includes('/anulowano')) {
      setPaymentStatus('cancelled');
      setError("Płatność została anulowana. Możesz spróbować ponownie.");
    }
  }, []);

  const fetchReport = async (sessionId, types, strategy) => {
    setIsLoading(true);
    setError("");
    
    const fileBlob = await fetch(localStorage.getItem('fileDataUrl')).then(res => res.blob());
    const file = new File([fileBlob], localStorage.getItem('fileName'), { type: fileBlob.type });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("variable_types_json", JSON.stringify(types));
    formData.append("missing_data_strategy", strategy);
    formData.append("session_id", sessionId);

    try {
      const response = await fetch(REPORT_URL, { method: "POST", body: formData });
      if (!response.ok) {
        const errorText = await response.text();
        try {
            const err = JSON.parse(errorText);
            throw new Error(err.detail || `Błąd serwera: ${response.status}`);
        } catch (e) {
            throw new Error(errorText || `Błąd serwera: ${response.status}`);
        }
      }
      const report = await response.text();
      setReportHtml(report);
      localStorage.clear();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Wgrywanie pliku i pobieranie podglądu ---
  const handleFileChangeAndPreview = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setOriginalFile(file);
    setIsLoading(true);
    setError("");
    setPreviewData(null);
    setReportHtml("");
    setPaymentStatus('idle');
    setMissingDataStrategy('');
    setMissingDataInfo({ has_missing_data: false, columns_with_missing_data: [] });

    const reader = new FileReader();
    reader.onload = function(e) {
      localStorage.setItem('fileDataUrl', e.target.result);
      localStorage.setItem('fileName', file.name);
    };
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(PREVIEW_URL, { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `Błąd serwera: ${response.status}`);
      }
      const data = await response.json();
      setPreviewData(data);
      setMissingDataInfo(data.missing_data_info);
      
      if (!data.missing_data_info.has_missing_data) {
        setMissingDataStrategy('none');
      }
      
      const initialTypes = {};
      data.columns.forEach(col => { initialTypes[col] = "pomiń"; });
      setVariableTypes(initialTypes);

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTypeChange = (columnName, newType) => {
    setVariableTypes(prevTypes => ({ ...prevTypes, [columnName]: newType }));
  };

  // --- Inicjowanie płatności ---
  const handlePayment = async () => {
    if (!originalFile || !variableTypes) {
      setError("Brakuje pliku lub zdefiniowanych typów zmiennych.");
      return;
    }
    setIsLoading(true);
    setError("");
    setPaymentStatus('processing');

    localStorage.setItem('variableTypes', JSON.stringify(variableTypes));
    localStorage.setItem('missingDataStrategy', missingDataStrategy);

    try {
      const response = await fetch(PAYMENT_URL, { method: "POST" });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Błąd tworzenia sesji płatności.");
      }
      const session = await response.json();
      window.location.href = session.url;
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
      setPaymentStatus('idle');
    }
  };

  const isButtonDisabled = (missingDataInfo.has_missing_data && !missingDataStrategy) || isLoading;

  // --- Renderowanie UI ---
  if (paymentStatus === 'success' && isLoading) {
    return <div style={{ padding: '30px', fontFamily: 'sans-serif', color: 'green' }}><h2>Płatność udana! Trwa generowanie raportu...</h2><p>To może potrwać do minuty. Proszę nie zamykać okna.</p></div>;
  }
  if (reportHtml) {
    return <div style={{ padding: '20px' }}><div dangerouslySetInnerHTML={{ __html: reportHtml }} /></div>;
  }

  return (
    <div style={{ padding: '30px', fontFamily: 'sans-serif' }}>
      <h1>Automatyczny Generator Raportów Statystycznych 📈</h1>
      <p>Proces generowania raportu składa się z trzech kroków.</p>

      {/* === SEKCJA KROKU 1: WGRYWANIE PLIKU === */}
      <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h2>Krok 1: Wgraj swój plik CSV</h2>
        <input type="file" accept=".csv" onChange={handleFileChangeAndPreview} disabled={isLoading} />
        {isLoading && !previewData && <p style={{ color: 'blue' }}>Wczytywanie podglądu...</p>}
        {error && <p style={{ color: 'red' }}><strong>Błąd:</strong> {error}</p>}
        {paymentStatus === 'cancelled' && <p style={{ color: 'orange' }}>Płatność anulowana.</p>}
      </div>

      {/* === SEKCJA KROKU 2: KONFIGURACJA ANALIZY === */}
      {previewData && (
        <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginTop: '20px' }}>
          <h2>Krok 2: Skonfiguruj swoją analizę</h2>
          
          {missingDataInfo.has_missing_data && (
            <div style={{ padding: '15px', background: '#fffbe6', border: '1px solid #ffc107', borderRadius: '5px', margin: '15px 0' }}>
              <h4>Wykryto brakujące dane!</h4>
              <p>Twój plik zawiera braki danych w kolumnach: <strong>{missingDataInfo.columns_with_missing_data.join(', ')}</strong>.</p>
              <p>Wybierz, w jaki sposób chcesz je obsłużyć:</p>
              <div>
                <input type="radio" id="strat_none" name="missing_data" value="none" onChange={e => setMissingDataStrategy(e.target.value)} />
                <label htmlFor="strat_none"> <strong>Moje dane są kompletne</strong> (spowoduje błąd, jeśli dane jednak mają braki).</label>
              </div>
              <div>
                <input type="radio" id="strat_delete_rows" name="missing_data" value="delete_rows" onChange={e => setMissingDataStrategy(e.target.value)} />
                <label htmlFor="strat_delete_rows"> <strong>Usuń wszystkie wiersze z brakami</strong> (może znacząco zmniejszyć zbiór danych).</label>
              </div>
              <div>
                <input type="radio" id="strat_delete" name="missing_data" value="delete_cols" onChange={e => setMissingDataStrategy(e.target.value)} />
                <label htmlFor="strat_delete"> <strong>Usuń całe kolumny z brakami</strong> (szybkie, ale możesz stracić ważne zmienne).</label>
              </div>
              <div>
                <input type="radio" id="strat_impute" name="missing_data" value="impute" onChange={e => setMissingDataStrategy(e.target.value)} />
                <label htmlFor="strat_impute"> <strong>Uzupełnij braki wartościami średnimi/dominantą</strong> (zachowujesz zmienne, ale możesz lekko zniekształcić dane).</label>
              </div>
            </div>
          )}

          <div style={{ padding: '10px', background: '#fff0f0', border: '1px solid red', borderRadius: '5px', margin: '15px 0' }}>
            ⚠️ **Ważna uwaga!** Poprawne wyniki zależą od poprawnego zdefiniowania typów zmiennych.
          </div>

          <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ padding: '8px' }}>Nazwa Zmiennej</th>
                <th style={{ padding: '8px', width: '300px' }}>Wybierz Typ Zmiennej</th>
                <th style={{ padding: '8px' }}>Podgląd Danych</th>
              </tr>
            </thead>
            <tbody>
              {previewData.columns.map((colName, colIndex) => (
                <tr key={colName}>
                  <td style={{ padding: '8px' }}><strong>{colName}</strong></td>
                  <td style={{ padding: '8px' }}>
                    <VariableTypeSelector columnName={colName} onChange={handleTypeChange} />
                  </td>
                  <td style={{ padding: '8px', fontStyle: 'italic', color: '#555' }}>
                    {previewData.preview_data.map(row => row[colIndex]).slice(0, 5).join(', ')}...
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* === SEKCJA KROKU 3: PŁATNOŚĆ I GENEROWANIE === */}
      {previewData && (
        <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginTop: '20px' }}>
          <h2>Krok 3: Wygeneruj raport (Koszt: 5.00 PLN)</h2>
          <button 
            onClick={handlePayment} 
            style={{ 
              fontSize: '18px', 
              padding: '10px 20px', 
              marginTop: '10px', 
              background: isButtonDisabled ? '#ccc' : 'green', 
              color: 'white',
              cursor: isButtonDisabled ? 'not-allowed' : 'pointer'
            }}
            disabled={isButtonDisabled}
          >
            {isLoading ? 'Przetwarzanie...' : 'Zapłać i Generuj Raport'}
          </button>
          {isButtonDisabled && missingDataInfo.has_missing_data && !missingDataStrategy && <p style={{color: 'red', marginTop: '10px'}}>Proszę wybrać strategię obsługi brakujących danych.</p>}
        </div>
      )}
    </div>
  );
}

export default App;