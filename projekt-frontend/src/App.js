import React, { useState, useEffect, useCallback } from 'react';

// === Endpointy na backendzie ===
const API_BASE_URL = (process.env.REACT_APP_API_URL || "https://analiza-danych.onrender.com") + "/api";
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
  const [missingDataInfo, setMissingDataInfo] = useState(null);

  const [reportUrl, setReportUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState('idle');

  // --- NOWA, UPROSZCZONA LOGIKA POBIERANIA RAPORTU ---
  const getFinalReport = useCallback(async (sessionId) => {
    setIsLoading(true);
    setError("");
    setPaymentStatus('success'); // Ustawiamy status sukcesu, żeby pokazać ekran ładowania

    try {
      const response = await fetch(REPORT_URL, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Nieznany błąd serwera.' }));
        throw new Error(errorData.detail || `Błąd serwera: ${response.status}`);
      }

      const reportHtml = await response.text();
      const blob = new Blob([reportHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setReportUrl(url);

    } catch (err) {
      setError(`Błąd podczas generowania raportu: ${err.message}`);
      setPaymentStatus('idle'); // Resetuj status w razie błędu
    } finally {
      setIsLoading(false);
    }
  }, []);

  // --- EFEKT DO OBSŁUGI POWROTU ZE STRIPE ---
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const sessionId = query.get('session_id');

    // Jeśli wracamy na stronę sukcesu z ID sesji, pobierz raport
    if (sessionId && window.location.pathname.includes('/sukces')) {
      // Wyczyść parametry z URL, aby uniknąć ponownego uruchomienia
      window.history.replaceState(null, '', '/sukces'); 
      getFinalReport(sessionId);
    }

    if (window.location.pathname.includes('/anulowano')) {
      setPaymentStatus('cancelled');
      setError("Płatność została anulowana. Możesz spróbować ponownie.");
      window.history.replaceState(null, '', '/');
    }

    // Efekt czyszczący
    return () => {
      if (reportUrl) {
        URL.revokeObjectURL(reportUrl);
      }
    };
  }, [getFinalReport, reportUrl]);


  // --- Wgrywanie pliku i pobieranie podglądu ---
  const handleFileChangeAndPreview = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setOriginalFile(file);
    setIsLoading(true);
    setError("");
    setPreviewData(null);
    setReportUrl("");
    setPaymentStatus('idle');
    setMissingDataStrategy('');
    setMissingDataInfo(null);

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

  // --- NOWA LOGIKA INICJOWANIA PŁATNOŚCI ---
  const handlePayment = async () => {
    if (!originalFile || !variableTypes || (missingDataInfo?.has_missing_data && !missingDataStrategy)) {
      setError("Brakuje pliku, zdefiniowanych typów zmiennych lub strategii dla braków danych.");
      return;
    }
    setIsLoading(true);
    setError("");
    setPaymentStatus('processing');

    const formData = new FormData();
    formData.append("file", originalFile);
    formData.append("variable_types_json", JSON.stringify(variableTypes));
    formData.append("missing_data_strategy", missingDataStrategy);

    try {
      // Wyślij plik i parametry, aby utworzyć sesję i zapisać dane na backendzie
      const response = await fetch(PAYMENT_URL, { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Błąd tworzenia sesji płatności.");
      }
      const session = await response.json();
      // Przekieruj do Stripe
      window.location.href = session.url;
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
      setPaymentStatus('idle');
    }
  };

  const isButtonDisabled = (missingDataInfo?.has_missing_data && !missingDataStrategy) || isLoading;

  // --- Renderowanie UI ---
  if (paymentStatus === 'success' && isLoading) {
    return <div style={{ padding: '30px', fontFamily: 'sans-serif', color: 'green', textAlign: 'center' }}><h2>Płatność udana! Trwa generowanie raportu...</h2><p>To może potrwać nawet kilka minut. Proszę nie zamykać okna.</p></div>;
  }
  if (reportUrl) {
    return (
      <div style={{display: 'flex', flexDirection: 'column', height: '100vh'}}>
        <div style={{padding: '10px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #dee2e6', textAlign: 'center'}}>
          <a href={reportUrl} download="raport.html" style={{...styles.ctaButton, textDecoration: 'none'}}>
            Pobierz Raport (plik HTML)
          </a>
        </div>
        <iframe 
          src={reportUrl}
          style={{ flex: 1, width: '100%', border: 'none' }}
          sandbox="allow-scripts allow-same-origin"
          title="Wygenerowany Raport Statystyczny"
        />
      </div>
    );
  }

  // Jeśli nie ma danych do podglądu, pokaż nową stronę powitalną
  if (!previewData) {
    return <LandingPage onFileChange={handleFileChangeAndPreview} isLoading={isLoading} error={error} />;
  }

  // Jeśli są dane do podglądu, pokaż przepływ analizy
  return (
    <AnalysisFlow
      previewData={previewData}
      missingDataInfo={missingDataInfo}
      missingDataStrategy={missingDataStrategy}
      setMissingDataStrategy={setMissingDataStrategy}
      variableTypes={variableTypes}
      handleTypeChange={handleTypeChange}
      handlePayment={handlePayment}
      isButtonDisabled={isButtonDisabled}
      isLoading={isLoading}
      error={error}
      paymentStatus={paymentStatus}
    />
  );
}

const LandingPage = ({ onFileChange, isLoading, error }) => {
  const fileInputRef = React.useRef(null);
  const handleButtonClick = () => fileInputRef.current.click();

  const copyEmailToClipboard = () => {
    navigator.clipboard.writeText('zwrotsrodkowanaliza@gmail.com');
    alert('Adres e-mail skopiowany do schowka!');
  };

  const copyUrlToClipboard = () => {
    navigator.clipboard.writeText('https://analiza-danych-python.vercel.app');
    alert('Adres strony skopiowany do schowka!');
  };
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Profesjonalna Analiza Danych za 8 zł (Oferta MVP)</h1>
        <p style={styles.subtitle}>Nasze narzędzie automatycznie przeprowadza testy statystyczne pomiędzy wszystkimi wprowadzonymi zmiennymi, weryfikuje ich założenia i dostarcza gotowy do interpretacji raport. Przekształć surowe dane w konkretne wnioski w zaledwie kilka minut.</p>
      </header>

      {/* === NOWA SEKCJA Z KLUCZOWYMI INFORMACJAMI === */}
      <section style={styles.keyInfoSection}>
        <div style={styles.keyInfoCard}>
          <h3 style={styles.h3}>Wymagany Format</h3>
          <p>Prześlij swoje dane w pliku <strong>.CSV</strong> rozdzielanym przecinkami.</p>
        </div>
        <div style={styles.keyInfoCard}>
          <h3 style={styles.h3}>Koszt Analizy</h3>
          <p>Jednorazowa opłata w wysokości <strong>8 zł</strong> za pełny, dwuczęściowy raport.</p>
        </div>
        <div style={styles.keyInfoCard}>
          <h3 style={styles.h3}>Co Otrzymasz?</h3>
          <p>W pełni <strong>interaktywny raport</strong> w formacie HTML, gotowy do zapisu i dalszej pracy.</p>
        </div>
        <div onClick={() => document.getElementById('kontakt').scrollIntoView({ behavior: 'smooth' })} style={{...styles.keyInfoCard, ...styles.clickableCard}}>
          <h3 style={styles.h3}>100% Gwarancji Satysfakcji</h3>
          <p>Jesteś naszym wczesnym użytkownikiem, dlatego Twoja satysfakcja jest absolutnym priorytetem. Jeśli raport nie spełni Twoich oczekiwań, wystąpi błąd lub po prostu nie będziesz zadowolony z wyniku – gwarantujemy pełny zwrot środków, bez zadawania pytań.</p>
        </div>
        <div style={styles.keyInfoCard}>
            <h3 style={styles.h3}>Zapisz naszą stronę na później</h3>
            <p>Nasza strona nie jest jeszcze w Google. Zapisz jej adres w zakładkach lub skopiuj go, aby móc tu wrócić.</p>
            <button onClick={copyUrlToClipboard} style={{...styles.ctaButton, fontSize: '1rem', padding: '10px 15px', marginTop: '10px'}}>Skopiuj Adres Strony</button>
        </div>
        <div style={styles.keyInfoCard}>
            <h3 style={styles.h3}>Problem po opłacie?</h3>
            <p>Jeśli raport się nie załaduje lub wystąpi błąd, napisz do nas. Gwarantujemy pomoc lub natychmiastowy zwrot środków.</p>
            <button onClick={copyEmailToClipboard} style={{...styles.ctaButton, fontSize: '1rem', padding: '10px 15px', marginTop: '10px'}}>Skopiuj Adres E-mail</button>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>Co zyskasz dzięki analizie?</h2>
        <p>Nasz raport w prosty sposób odpowie na fundamentalne pytania:</p>
        <ul style={styles.list}>
            <li><strong>Które zależności są prawdziwe?</strong> Dowiesz się, które zmienne mają na siebie realny, statystycznie istotny wpływ, a które zależności są tylko pozorne.</li>
            <li><strong>Jakie wnioski są wiarygodne?</strong> Otrzymasz informację, czy założenia dla każdego testu zostały spełnione, co oznacza, że możesz ufać jego wynikom.</li>
            <li><strong>Jak oszczędzić czas?</strong> Zamiast ręcznie przeprowadzać dziesiątki testów, otrzymasz kompletny przegląd w kilka minut, co pozwoli Ci skupić się na interpretacji i dalszej pracy.</li>
            <li><strong>Jak interpretować wyniki bez wiedzy statystycznej?</strong> Nasz raport zawiera specjalne podsumowanie, które podświetla tylko te zależności, które są najważniejsze i najbardziej wiarygodne. Nawet bez specjalistycznej wiedzy, od razu zobaczysz, które zmienne w Twoich danych mają na siebie realny, uzasadniony wpływ.</li>
        </ul>
      </section>

      <main>
        <section id="upload-section" style={styles.uploadSection}>
          <h2 style={styles.h2}>Rozpocznij w 3 prostych krokach</h2>
          <div style={styles.stepsGrid}>
            <div style={styles.step}><strong>Krok 1:</strong> Wgraj plik CSV</div>
            <div style={styles.step}><strong>Krok 2:</strong> Zdefiniuj typy zmiennych</div>
            <div style={styles.step}><strong>Krok 3:</strong> Odbierz gotowy raport</div>
          </div>
          <button onClick={handleButtonClick} style={styles.ctaButton} disabled={isLoading}>
            {isLoading ? 'Przetwarzanie...' : 'Rozpocznij Analizę - Wgraj Plik CSV'}
          </button>
          <input type="file" ref={fileInputRef} onChange={onFileChange} accept=".csv" style={{ display: 'none' }} />
          {isLoading && <p style={{marginTop: '15px', color: '#555'}}>Trwa przesyłanie i wstępna analiza Twojego pliku. W zależności od jego rozmiaru może to potrwać nawet kilka minut. Prosimy o cierpliwość.</p>}
          {error && <p style={{ color: 'red', marginTop: '15px' }}><strong>Błąd:</strong> {error}</p>}
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Idealne rozwiązanie, jeśli...</h2>
          <div style={styles.personaGrid}>
            <div style={styles.personaCard}>
              <h3 style={styles.h3}>Jesteś Studentem lub Naukowcem</h3>
              <p>Piszesz pracę dyplomową i nie wiesz, od czego zacząć analizę? Zastanawiasz się, które testy będą odpowiednie i czy spełniasz ich rygorystyczne założenia? Nasz raport wskaże istotne zależności i sprawdzi założenia, dając Ci idealny punkt wyjścia do dalszych badań.</p>
            </div>
            <div style={styles.personaCard}>
              <h3 style={styles.h3}>Jesteś Analitykiem lub Przedsiębiorcą</h3>
              <p>Chcesz szybko sprawdzić, czy istnieją związki w Twoich danych o sprzedaży lub marketingu, zanim zainwestujesz w drogie oprogramowanie? W kilka minut otrzymaj wstępny audyt zależności i zobacz, gdzie warto szukać głębszych insightów biznesowych.</p>
            </div>
            <div style={styles.personaCard}>
              <h3 style={styles.h3}>Jesteś Entuzjastą Danych</h3>
              <p>Po prostu lubisz analizować dane i odkrywać wzorce? Chcesz w praktyce zobaczyć, jak teoria statystyczna przekłada się na wyniki? Nasze narzędzie to świetna piaskownica do nauki i eksploracji, pokazująca, jak wygląda profesjonalny raport.</p>
            </div>
          </div>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Co dokładnie otrzymasz w cenie kawy?</h2>
          <p>Twój kompleksowy raport składa się z dwóch kluczowych części:</p>
          <ul style={styles.list}>
            <li><strong>Część 1: Rozszerzona Analiza Opisowa:</strong> Pełny profil każdej zmiennej – od rozkładów i kwantyli, przez statystyki opisowe, aż po interaktywne wykresy.</li>
            <li><strong>Część 2: Akademicka Analiza Wnioskująca:</strong> To serce naszego narzędzia. Automatycznie testujemy zależności pomiędzy wszystkimi wprowadzonymi zmiennymi, stosując rygorystyczne metody statystyczne:
                <ul style={{paddingLeft: '20px', marginTop: '10px'}}>
                    <li><strong>Inteligentny dobór testów:</strong> System sam wybiera odpowiedni test (t-Studenta, chi-kwadrat, regresja itp.) dla Twoich par zmiennych.</li>
                    <li><strong>Weryfikacja założeń i testy odporne:</strong> Sprawdzamy, czy spełnione są kluczowe założenia każdego testu. Jeśli nie, automatycznie stosujemy odpowiednie <strong>testy odporne (nieparametryczne)</strong>, aby Twoje wnioski były jak najbardziej wiarygodne.</li>
                    <li><strong>Korekta na wielokrotne porównania:</strong> Aby uniknąć fałszywych odkryć, stosujemy <strong>korektę Bonferroniego</strong>, która dostosowuje poziom istotności statystycznej, dając Ci pewność, że widzisz tylko te wyniki, które mają najmocniejsze uzasadnienie.</li>
                </ul>
            </li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Transparentność: Dlaczego tylko 8 zł?</h2>
          <p>Standardowa, wstępna analiza danych wykonana przez profesjonalnego analityka to koszt rzędu <strong>kilkuset złotych</strong>. Nasze narzędzie automatyzuje ten proces, ale jest obecnie w fazie <strong>MVP (Minimum Viable Product)</strong> – pierwszej, funkcjonalnej wersji produktu.</p>
          <p>Twoja opłata to nie tylko dostęp do potężnej analizy, ale także realne wsparcie w rozwoju tego projektu. Dzięki Twojemu zaangażowaniu możemy go dalej udoskonalać. W zamian za zaufanie na tym wczesnym etapie oferujemy Ci usługę w symbolicznej cenie.</p>
        </section>

      </main>
      <Footer />
    </div>
  );
};

const AnalysisFlow = ({ previewData, missingDataInfo, missingDataStrategy, setMissingDataStrategy, variableTypes, handleTypeChange, handlePayment, isButtonDisabled, isLoading, error, paymentStatus }) => (
  <div style={styles.container}>
    <header style={styles.header}>
      <h1 style={styles.h1}>Konfiguracja Analizy</h1>
      <p style={styles.subtitle}>Prawie gotowe! Skonfiguruj ostatnie szczegóły, aby wygenerować swój raport.</p>
    </header>

    <div style={styles.analysisBox}>
      <h2 style={styles.h2}>Krok 2: Skonfiguruj swoją analizę</h2>
      
      {missingDataInfo?.has_missing_data && (
        <div style={styles.missingDataPanel}>
          <h3 style={{ color: '#721c24', marginTop: 0 }}>Wykryto braki w danych!</h3>
          {missingDataInfo.detection_method && <p><strong>Metoda wykrywania:</strong> {missingDataInfo.detection_method}</p>}
          {missingDataInfo.missing_value_locations?.length > 0 && (
            <div>
              <strong>Przykładowe lokalizacje:</strong>
              <ul style={{ paddingLeft: '20px', margin: '5px 0', listStyleType: 'square' }}>
                {missingDataInfo.missing_value_locations.map((loc, i) => <li key={i}>{loc}</li>)}
              </ul>
            </div>
          )}
          <p style={{ marginTop: '20px' }}><strong>Wybierz, co chcesz zrobić z brakującymi danymi:</strong></p>
          {['delete_rows', 'delete_cols', 'impute'].map(strategy => (
            <div key={strategy}>
              <input type="radio" id={`strat_${strategy}`} name="missing_data" value={strategy} onChange={e => setMissingDataStrategy(e.target.value)} />
              <label htmlFor={`strat_${strategy}`}> {
                {
                  'delete_rows': 'Usuń wszystkie wiersze z brakami.',
                  'delete_cols': 'Usuń całe kolumny z brakami.',
                  'impute': 'Uzupełnij braki wartościami średnimi/dominantą.'
                }[strategy]
              }</label>
            </div>
          ))}
        </div>
      )}

      <div style={styles.warningBox}>
        ⚠️ <strong>Ważna uwaga!</strong> Poprawne wyniki zależą od poprawnego zdefiniowania typów zmiennych.
      </div>

      <table style={styles.table}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={styles.th}>Nazwa Zmiennej</th>
            <th style={styles.th}>Wybierz Typ Zmiennej</th>
            <th style={styles.th}>Podgląd Danych</th>
          </tr>
        </thead>
        <tbody>
          {previewData.columns.map((colName, colIndex) => (
            <tr key={colName}>
              <td style={styles.td}><strong>{colName}</strong></td>
              <td style={styles.td}><VariableTypeSelector columnName={colName} onChange={handleTypeChange} /></td>
              <td style={styles.td}>{previewData.preview_data.map(row => row[colIndex]).slice(0, 5).join(', ')}...</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div style={styles.analysisBox}>
      <h2 style={styles.h2}>Krok 3: Wygeneruj raport (Koszt: 8.00 PLN)</h2>
      <button onClick={handlePayment} style={isButtonDisabled ? styles.ctaButtonDisabled : styles.ctaButton} disabled={isButtonDisabled}>
        {isLoading ? 'Przetwarzanie...' : 'Zapłać i Generuj Raport'}
      </button>
      {isButtonDisabled && missingDataInfo?.has_missing_data && !missingDataStrategy && <p style={{color: 'red', marginTop: '10px'}}>Proszę wybrać strategię obsługi brakujących danych.</p>}
      {error && <p style={{ color: 'red', marginTop: '15px' }}><strong>Błąd:</strong> {error}</p>}
      {paymentStatus === 'cancelled' && <p style={{ color: 'orange' }}>Płatność anulowana.</p>}
    </div>
    <Footer />
  </div>
);

const Footer = () => (
  <footer id="kontakt" style={styles.footer}>
    <p>Masz pytania lub raport nie spełnił Twoich oczekiwań? Gwarantujemy zwrot środków w ciągu 3 dni. Napisz na: <strong>zwrotsrodkowanaliza@gmail.com</strong></p>
  </footer>
);

// === Style ===
const styles = {
  container: { maxWidth: '960px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', color: '#333' },
  header: { textAlign: 'center', marginBottom: '40px', paddingBottom: '20px', borderBottom: '1px solid #eee' },
  h1: { fontSize: '2.5rem', color: '#2c3e50', marginBottom: '10px' },
  h2: { fontSize: '2rem', color: '#34495e', borderBottom: '2px solid #3498db', paddingBottom: '10px', marginTop: '40px' },
  h3: { fontSize: '1.2rem', color: '#34495e', marginBottom: '10px' },
  subtitle: { fontSize: '1.2rem', color: '#7f8c8d', maxWidth: '800px', margin: '0 auto' },
  section: { marginBottom: '40px' },
  keyInfoSection: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '40px', textAlign: 'center' },
  keyInfoCard: { backgroundColor: '#ecf0f1', padding: '20px', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
  clickableCard: { cursor: 'pointer', backgroundColor: '#e0e6e8', transition: 'transform 0.2s, box-shadow 0.2s', ':hover': { transform: 'scale(1.02)', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' } },
  uploadSection: { textAlign: 'center', backgroundColor: '#f8f9fa', padding: '40px 20px', borderRadius: '8px', border: '1px solid #dee2e6' },
  stepsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', margin: '20px 0' },
  step: { backgroundColor: '#fff', padding: '15px', borderRadius: '5px', border: '1px solid #ccc' },
  ctaButton: { backgroundColor: '#3498db', color: 'white', border: 'none', padding: '15px 30px', fontSize: '1.2rem', borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.3s' },
  ctaButtonDisabled: { backgroundColor: '#bdc3c7', color: '#7f8c8d', border: 'none', padding: '15px 30px', fontSize: '1.2rem', borderRadius: '5px', cursor: 'not-allowed' },
  personaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' },
  personaCard: { backgroundColor: '#f8f9fa', padding: '20px', borderRadius: '5px', border: '1px solid #eee' },
  list: { paddingLeft: '20px', lineHeight: '1.6' },
  guaranteeSection: { backgroundColor: '#ecf0f1', padding: '20px', borderRadius: '8px', textAlign: 'center' },
  footer: { textAlign: 'center', marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #eee', color: '#7f8c8d', fontSize: '0.9rem' },
  analysisBox: { padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginTop: '20px' },
  missingDataPanel: { border: '2px solid #dc3545', padding: '15px', marginTop: '20px', borderRadius: '5px', backgroundColor: '#f8d7da' },
  warningBox: { padding: '10px', background: '#fffbe6', border: '1px solid #ffc107', borderRadius: '5px', margin: '15px 0' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '20px' },
  th: { padding: '12px', border: '1px solid #ddd', backgroundColor: '#f2f2f2', textAlign: 'left' },
  td: { padding: '12px', border: '1px solid #ddd', verticalAlign: 'top' },
};

export default App;
