import os
from pydataset import data
import pandas as pd
import seaborn as sns

# Definiuje ścieżkę do folderu
DATA_DIR = 'test_datasets'

# Lista zbiorów danych do pobrania
datasets_to_download = ['Boston', 'Titanic', 'iris', 'Housing', 'mtcars']

# Sprawdzenie, czy folder istnieje
if not os.path.exists(DATA_DIR):
    print(f"Błąd: Folder '{DATA_DIR}' nie istnieje. Utwórz go najpierw.")
else:
    for dataset_name in datasets_to_download:
        try:
            print(f"Pobieranie zbioru danych '{dataset_name}'...")
            
            df = None
            # Specjalna obsługa dla zbioru Titanic, aby pobrać właściwą wersję
            if dataset_name == 'Titanic':
                print("Ładowanie szczegółowego zbioru Titanic z biblioteki seaborn...")
                df = sns.load_dataset('titanic')
            else:
                # Ładowanie danych z pydataset dla pozostałych zbiorów
                df = data(dataset_name)
            
            if df is not None and not df.empty:
                # Ścieżka do pliku CSV
                file_path = os.path.join(DATA_DIR, f'{dataset_name.lower()}.csv')
                
                # Zapis do CSV
                df.to_csv(file_path, index=False)
                
                print(f"\nZbiór danych '{dataset_name}' został pomyślnie zapisany w '{file_path}'")
                print(f"Liczba wierszy: {len(df)}")
                print(f"Liczba kolumn: {len(df.columns)}")
                print("Pierwsze 5 wierszy:")
                print(df.head())
                print("-" * 30)
                
            else:
                print(f"Ostrzeżenie: Nie udało się załadować zbioru '{dataset_name}'. Może być pusty.")

        except Exception as e:
            print(f"Wystąpił błąd podczas pobierania lub zapisywania danych dla '{dataset_name}': {e}")