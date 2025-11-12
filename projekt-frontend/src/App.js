import React, { useState, useEffect } from 'react';

// === Endpointy na backendzie ===
const API_BASE_URL = (process.env.REACT_APP_API_URL || "https://analiza-danych.onrender.com") + "/api";
const PREVIEW_URL = `${API_BASE_URL}/parse-preview`;
const VOLUNTARY_PAYMENT_URL = `${API_BASE_URL}/create-voluntary-payment-session`;
const GENERATE_REPORT_URL = `${API_BASE_URL}/generate-report`;

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
  const [currentReportId, setCurrentReportId] = useState(null); // Nowy stan dla ID raportu
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [voluntaryPaymentStatus, setVoluntaryPaymentStatus] = useState('idle'); // Nowy stan dla statusu dobrowolnej płatności

  // --- EFEKT DO OBSŁUGI POWROTU ZE STRIPE (dla dobrowolnej płatności) ---
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const paymentStatus = query.get('payment_status');
    const reportIdFromUrl = query.get('report_id');

    if (reportIdFromUrl && (paymentStatus === 'success' || paymentStatus === 'cancelled')) {
      setCurrentReportId(reportIdFromUrl);
      setVoluntaryPaymentStatus(paymentStatus);
      // Wyczyść parametry z URL
      window.history.replaceState(null, '', `/raport/${reportIdFromUrl}`);
    }
  }, []);

  // --- Wgrywanie pliku i pobieranie podglądu ---
  const handleFileChangeAndPreview = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setOriginalFile(file);
    setIsLoading(true);
    setError("");
    setPreviewData(null);
    setReportUrl("");
    setCurrentReportId(null);
    setMissingDataStrategy('');
    setMissingDataInfo(null);
    setVoluntaryPaymentStatus('idle');

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

  // --- Generowanie raportu (teraz bezpłatne) ---
  const generateReport = async () => {
    if (!originalFile || !variableTypes || (missingDataInfo?.has_missing_data && !missingDataStrategy)) {
      setError("Brakuje pliku, zdefiniowanych typów zmiennych lub strategii dla braków danych.");
      return;
    }
    setIsLoading(true);
    setError("");
    setReportUrl("");
    setCurrentReportId(null);
    setVoluntaryPaymentStatus('idle');

    const formData = new FormData();
    formData.append("file", originalFile);
    formData.append("variable_types_json", JSON.stringify(variableTypes));
    formData.append("missing_data_strategy", missingDataStrategy);

    try {
      const response = await fetch(GENERATE_REPORT_URL, { method: "POST", body: formData });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Nieznany błąd serwera.' }));
        throw new Error(errorData.detail || `Błąd serwera: ${response.status}`);
      }
      const data = await response.json();
      const blob = new Blob([data.report_html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setReportUrl(url);
      setCurrentReportId(data.report_id);

    } catch (err) {
      setError(`Błąd podczas generowania raportu: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Obsługa dobrowolnej płatności po wygenerowaniu raportu ---
  const handleVoluntaryPayment = async (amount = 300) => { // Domyślnie 300 groszy = 3 PLN
    if (!currentReportId) {
      setError("Brak ID raportu do powiązania z płatnością.");
      return;
    }
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(VOLUNTARY_PAYMENT_URL, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ report_id: currentReportId, amount: amount }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Błąd tworzenia sesji płatności.");
      }
      const session = await response.json();
      window.location.href = session.url; // Przekieruj do Stripe
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const isButtonDisabled = (missingDataInfo?.has_missing_data && !missingDataStrategy) || isLoading;

  // --- Renderowanie UI ---
  if (reportUrl) {
    return (
      <div style={{display: 'flex', flexDirection: 'column', height: '100vh'}}>
        <div style={{padding: '10px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #dee2e6', textAlign: 'center'}}>
          <a href={reportUrl} download="raport.html" style={{...styles.ctaButton, textDecoration: 'none'}}>
            Pobierz Raport (plik HTML)
          </a>
          {currentReportId && (
            <div style={styles.voluntaryPaymentBanner}>
              <h3>Jesteś zadowolony z naszej analizy? Wesprzyj nas!</h3>
              <p>To narzędzie jest w fazie MVP i udostępniamy je bezpłatnie. Korzystasz z niego jako <strong>pierwszy użytkownik</strong>. Jeśli raport okazał się dla Ciebie użyteczny, będziemy wdzięczni za dobrowolną wpłatę.</p>
              <p>Sugerowana kwota to <strong>od 3 zł</strong> (Stripe pobiera ok. 1 zł prowizji za transakcję).</p>
              {voluntaryPaymentStatus === 'success' && <p style={{color: 'green'}}>Dziękujemy za wsparcie!</p>}
              {voluntaryPaymentStatus === 'cancelled' && <p style={{color: 'orange'}}>Płatność anulowana. Możesz spróbować ponownie.</p>}
              <button onClick={() => handleVoluntaryPayment(300)} style={{...styles.ctaButton, backgroundColor: '#6772e5', marginRight: '10px'}}>
                Wpłać 3 zł
              </button>
              <button onClick={() => handleVoluntaryPayment(500)} style={{...styles.ctaButton, backgroundColor: '#6772e5', marginRight: '10px'}}>
                Wpłać 5 zł
              </button>
              <button onClick={() => handleVoluntaryPayment(1000)} style={{...styles.ctaButton, backgroundColor: '#6772e5'}}>
                Wpłać 10 zł
              </button>
            </div>
          )}
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
      generateReport={generateReport} // Zmienione z handlePayment
      isButtonDisabled={isButtonDisabled}
      isLoading={isLoading}
      error={error}
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
        <h1 style={styles.h1}>Eksploracyjna Analiza Danych (Wersja MVP)</h1>
        <p style={styles.subtitle}>Nasze narzędzie służy do wstępnej eksploracji danych. Automatycznie przeprowadza podstawowe testy statystyczne między zmiennymi i generuje raport, który może być punktem wyjścia do dalszej, pogłębionej analizy. To narzędzie do szerokiego spojrzenia na dane, a nie wyciągania ostatecznych wniosków.</p>
      </header>

      {/* === NOWA SEKCJA Z KLUCZOWYMI INFORMACJAMI === */}
      <section style={styles.keyInfoSection}>
        <div style={styles.keyInfoCard}>
          <h3 style={styles.h3}>Wymagany Format</h3>
          <p>Prześlij swoje dane w pliku <strong>.CSV</strong> rozdzielanym przecinkami.</p>
        </div>
                  <div style={styles.keyInfoCard}>
                    <h3 style={styles.h3}>Koszt Analizy</h3>
                    <p>Analiza jest <strong>bezpłatna</strong>. Możesz testować za darmo. Będziemy wdzięczni za jakąkolwiek wpłatę po wygenerowaniu raportu, jeśli okaże się użyteczny.</p>
                  </div>        <div style={styles.keyInfoCard}>
          <h3 style={styles.h3}>Co Otrzymasz?</h3>
          <p>W pełni <strong>interaktywny raport</strong> w formacie HTML, gotowy do zapisu i dalszej pracy.</p>
        </div>
        <div onClick={() => document.getElementById('kontakt').scrollIntoView({ behavior: 'smooth' })} style={{...styles.keyInfoCard, ...styles.clickableCard}}>
          <h3 style={styles.h3}>Gwarancja Satysfakcji</h3>
          <p>Jesteśmy na wczesnym etapie rozwoju (MVP). Twoja satysfakcja jest dla nas kluczowa. Jeśli raport nie spełni Twoich oczekiwań, wystąpi błąd lub po prostu uznasz, że wynik nie jest dla Ciebie użyteczny – gwarantujemy pełny zwrot środków.</p>
        </div>
        <div style={styles.keyInfoCard}>
            <h3 style={styles.h3}>Zapisz naszą stronę na później</h3>
            <p>Nasza strona nie jest jeszcze w Google. Zapisz jej adres w zakładkach lub skopiuj go, aby móc tu wrócić.</p>
            <button onClick={copyUrlToClipboard} style={{...styles.ctaButton, fontSize: '1rem', padding: '10px 15px', marginTop: '10px'}}>Skopiuj Adres Strony</button>
        </div>
        <div style={styles.keyInfoCard}>
            <h3 style={styles.h3}>Problem z raportem?</h3>
            <p>Jeśli raport się nie załaduje lub wystąpi błąd, napisz do nas. Pomożemy lub zwrócimy wpłacone środki.</p>
            <button onClick={copyEmailToClipboard} style={{...styles.ctaButton, fontSize: '1rem', padding: '10px 15px', marginTop: '10px'}}>Skopiuj Adres E-mail</button>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>Do czego służy ta analiza?</h2>
        <p>Nasz raport w prosty sposób odpowie na fundamentalne pytania:</p>
        <ul style={styles.list}>
            <li><strong>Wstępna identyfikacja zależności:</strong> Narzędzie wskaże, które zmienne wykazują statystycznie istotne korelacje lub różnice. Pamiętaj, że korelacja nie oznacza przyczynowości.</li>
            <li><strong>Ocena wiarygodności testów:</strong> Otrzymasz informację, czy założenia dla każdego testu zostały spełnione, co jest kluczowe dla prawidłowej interpretacji jego wyniku.</li>
            <li><strong>Automatyzacja wstępnego etapu:</strong> Zamiast ręcznie przeprowadzać dziesiątki testów, otrzymasz ich przegląd w kilka minut. Pozwoli Ci to skupić się na dalszej, pogłębionej analizie i interpretacji.</li>
            <li><strong>Podsumowanie dla szybkiego przeglądu:</strong> Raport zawiera podsumowanie, które wyróżnia statystycznie istotne wyniki. Pamiętaj jednak, że jest to jedynie sugestia, a każdy wynik wymaga indywidualnej interpretacji w kontekście Twoich danych i dziedziny.</li>
        </ul>
      </section>

      <section style={styles.importantWarning}>
        <h3 style={{ marginTop: 0, color: '#856404' }}>Ważna informacja o charakterze analizy</h3>
        <p>Wyniki przedstawione w tym raporcie mają charakter wyłącznie eksploracyjny i poglądowy. Nie powinny być traktowane jako podstawa do podejmowania decyzji biznesowych, klinicznych, finansowych ani żadnych innych działań o wysokich konsekwencjach. Interpretacja wyników statystycznych wymaga specjalistycznej wiedzy i kontekstu dziedzinowego. W celu podjęcia wiążących decyzji, zalecamy konsultację z profesjonalnym analitykiem danych lub statystykiem.</p>
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
              <p>Piszesz pracę i szukasz punktu wyjścia do analizy? Narzędzie pomoże Ci wstępnie zidentyfikować istotne zależności i sprawdzić założenia testów, co może ukierunkować Twoje dalsze, szczegółowe badania.</p>
            </div>
            <div style={styles.personaCard}>
              <h3 style={styles.h3}>Jesteś Analitykiem lub Przedsiębiorcą</h3>
              <p>Chcesz szybko przeskanować dane w poszukiwaniu potencjalnych związków, zanim zdecydujesz się na głębszą analizę? Narzędzie dostarczy Ci wstępnego przeglądu, który może pomóc w formułowaniu hipotez do dalszej weryfikacji.</p>
            </div>
            <div style={styles.personaCard}>
              <h3 style={styles.h3}>Jesteś Entuzjastą Danych</h3>
              <p>Chcesz zobaczyć, jak podstawowe testy statystyczne działają w praktyce na Twoim zbiorze danych? Nasze narzędzie to środowisko do nauki i eksploracji, które pokazuje wyniki analizy w przystępnej formie.</p>
            </div>
          </div>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Co zawiera raport?</h2>
          <p>Twój raport składa się z dwóch części:</p>
          <ul style={styles.list}>
            <li><strong>Część 1: Rozszerzona Analiza Opisowa:</strong> Pełny profil każdej zmiennej – od rozkładów i kwantyli, przez statystyki opisowe, aż po interaktywne wykresy.</li>
            <li><strong>Część 2: Analiza Wnioskująca:</strong> To główna część analizy. Narzędzie automatycznie testuje zależności pomiędzy parami zmiennych, stosując podstawowe metody statystyczne:
                <ul style={{paddingLeft: '20px', marginTop: '10px'}}>
                    <li><strong>Inteligentny dobór testów:</strong> System sam wybiera odpowiedni test (t-Studenta, chi-kwadrat, regresja itp.) dla Twoich par zmiennych.</li>
                    <li><strong>Weryfikacja założeń i dobór testów:</strong> Sprawdzamy podstawowe założenia dla wybranych testów. W przypadku ich niespełnienia, w miarę możliwości stosujemy ich nieparametryczne odpowiedniki, aby zwiększyć rzetelność wyników.</li>
                    <li><strong>Korekta na wielokrotne porównania:</strong> Aby ograniczyć ryzyko fałszywych odkryć wynikające z dużej liczby testów, stosujemy <strong>korektę Bonferroniego</strong>. Należy jednak pamiętać, że jest to metoda konserwatywna i może pomijać niektóre rzeczywiste zależności.</li>
                </ul>
            </li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>Transparentność: Dlaczego bezpłatnie?</h2>
          <p>Wstępna, eksploracyjna analiza danych wykonana przez analityka to usługa wymagająca czasu i wiedzy. Nasze narzędzie automatyzuje ten proces, ale jest obecnie w fazie <strong>MVP (Minimum Viable Product)</strong> – pierwszej, funkcjonalnej wersji.</p>
          <p>Udostępniamy je bezpłatnie, ponieważ Twoje zaangażowanie i opinie są dla nas bezcenne w dalszym rozwoju projektu. Jeśli raport okaże się dla Ciebie użyteczny, będziemy wdzięczni za dobrowolną wpłatę, która pomoże nam w utrzymaniu i udoskonalaniu narzędzia.</p>
        </section>

      </main>
      <Footer />
    </div>
  );
};

const AnalysisFlow = ({ previewData, missingDataInfo, missingDataStrategy, setMissingDataStrategy, variableTypes, handleTypeChange, generateReport, isButtonDisabled, isLoading, error }) => (
  <div style={styles.container}>
    <header style={styles.header}>
      <h1 style={styles.h1}>Konfiguracja Analizy</h1>
      <p style={styles.subtitle}>Prawie gotowe! Skonfiguruj ostatnie szczegóły, aby wygenerować swój raport.</p>
    </header>

    <div style={styles.analysisBox}>
      <h2 style={styles.h2}>Krok 2: Skonfiguruj swoją analizę</h2>

      {/* NEW SECTION FOR VARIABLE TYPE EXPLANATIONS */}
      <div style={styles.infoBox}>
        <h3 style={styles.h3}>Wybór Typów Zmiennych: Przewodnik</h3>
        <p>Poprawne zdefiniowanie typów zmiennych jest kluczowe dla prawidłowej analizy statystycznej. Poniżej znajdziesz wyjaśnienie każdej kategorii, które pomoże Ci dokonać właściwego wyboru:</p>
        <ul style={styles.list}>
          <li><strong>Pomiń (np. ID, Tekst, Data):</strong> Zmienna zostanie całkowicie zignorowana w procesie analizy. Wybierz tę opcję dla zmiennych, które służą jedynie jako identyfikatory (np. ID klienta, numer transakcji), zawierają wolny tekst (np. opisy produktów, komentarze), lub są datami, które nie będą analizowane jako zmienne czasowe.</li>
          <li><strong>Ciągła (np. Wiek, Przychód, Temperatura):</strong> Zmienna numeryczna, która może przyjmować dowolną wartość w danym zakresie, często z nieskończoną liczbą możliwych wartości między dwoma punktami (np. liczby rzeczywiste). Reprezentuje pomiary, takie jak wiek, wzrost, waga, dochód, temperatura, ciśnienie krwi. Dla tych zmiennych stosuje się testy korelacji (np. Pearsona) lub porównania średnich (np. t-Studenta, ANOVA).</li>
          <li><strong>Binarna (2 grupy, np. Płeć, Status_Klienta: Aktywny/Nieaktywny):</strong> Zmienna kategoryczna, która może przyjmować tylko dwie, wzajemnie wykluczające się wartości. Przykłady to płeć (Mężczyzna/Kobieta), status (Tak/Nie, Prawda/Fałsz), obecność cechy (Posiada/Nie posiada). Analiza często polega na porównywaniu proporcji lub średnich między tymi dwiema grupami.</li>
          <li><strong>Nominalna (Kategoryczna, 3+ grup, np. Miasto, Kolor Oczu, Narodowość):</strong> Zmienna kategoryczna, która może przyjmować trzy lub więcej wartości, ale bez naturalnego porządku, hierarchii czy rangi między nimi. Wartości te są jedynie etykietami. Przykłady to miasto zamieszkania, kolor oczu, narodowość, typ produktu. Dla tych zmiennych często stosuje się testy chi-kwadrat do badania zależności między kategoriami.</li>
          <li><strong>Porządkowa (kolejność, np. Wykształcenie, Ocena Satysfakcji: Niska/Średnia/Wysoka):</strong> Zmienna kategoryczna, która może przyjmować trzy lub więcej wartości, ale z wyraźnym porządkiem, hierarchią lub rangą. Odległości między kategoriami nie muszą być równe, ale kolejność jest znacząca. Przykłady to poziom wykształcenia (podstawowe, średnie, wyższe), ocena satysfakcji (bardzo niska, niska, średnia, wysoka, bardzo wysoka), stopień wojskowy. Dla tych zmiennych stosuje się testy nieparametryczne, które uwzględniają porządek, ale nie zakładają rozkładu normalnego (np. korelacja Spearmana).</li>
        </ul>
      </div>
      {/* END NEW SECTION */}

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
      <h2 style={styles.h2}>Krok 3: Wygeneruj raport</h2>
      <button onClick={generateReport} style={isButtonDisabled ? styles.ctaButtonDisabled : styles.ctaButton} disabled={isButtonDisabled}>
        {isLoading ? 'Przetwarzanie...' : 'Generuj Raport'}
      </button>
      {isButtonDisabled && missingDataInfo?.has_missing_data && !missingDataStrategy && <p style={{color: 'red', marginTop: '10px'}}>Proszę wybrać strategię obsługi brakujących danych.</p>}
      {error && <p style={{ color: 'red', marginTop: '15px' }}><strong>Błąd:</strong> {error}</p>}
    </div>
    <Footer />
  </div>
);

const Footer = () => (
  <footer id="kontakt" style={styles.footer}>
    <p>Masz pytania lub raport nie spełnił Twoich oczekiwań? Napisz na: <strong>zwrotsrodkowanaliza@gmail.com</strong></p>
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
  importantWarning: {
    backgroundColor: '#fff3cd',
    color: '#856404',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ffeeba',
    margin: '30px 0',
    textAlign: 'left',
  },
  infoBox: {
    backgroundColor: '#e7f3fe', // A light blue
    border: '1px solid #b3d4fc',
    borderRadius: '8px',
    padding: '20px',
    margin: '20px 0',
  },
  analysisBox: { padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginTop: '20px' },
  missingDataPanel: { border: '2px solid #dc3545', padding: '15px', marginTop: '20px', borderRadius: '5px', backgroundColor: '#f8d7da' },
  warningBox: { padding: '10px', background: '#fffbe6', border: '1px solid #ffc107', borderRadius: '5px', margin: '15px 0' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '20px' },
  th: { padding: '12px', border: '1px solid #ddd', backgroundColor: '#f2f2f2', textAlign: 'left' },
  td: { padding: '12px', border: '1px solid #ddd', verticalAlign: 'top' },
  voluntaryPaymentBanner: {
    marginTop: '20px',
    padding: '20px',
    backgroundColor: '#e6ffe6', // Light green background
    border: '1px solid #a3e9a4',
    borderRadius: '8px',
    textAlign: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
};

export default App;
