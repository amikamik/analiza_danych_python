import pandas as pd
import numpy as np
import random

def generate_sample_csv(filename="sample_data.csv", num_rows=1000):
    """
    Generuje przykładowy plik CSV z różnymi typami danych.

    Kolumny:
    - ID (ciągła, unikalna)
    - Wiek (ciągła, rozkład normalny)
    - Płeć (kategorystyczna, dyskretna)
    - Miasto (kategorystyczna, z brakami danych)
    - Liczba_Dzieci (skokowa, całkowita)
    - Przychód (ciągła, z dużą wariancją)
    - Czy_Aktywny (binarna)
    - Data_Rejestracji (data)
    - Opis (tekstowa, z brakami danych i różnymi długościami)
    """

    data = {}

    # 1. ID (ciągła, unikalna)
    data["ID"] = np.arange(1, num_rows + 1)

    # 2. Wiek (ciągła, rozkład normalny)
    data["Wiek"] = np.random.normal(loc=35, scale=10, size=num_rows).astype(int)
    data["Wiek"][data["Wiek"] < 18] = 18 # Minimalny wiek 18
    data["Wiek"][data["Wiek"] > 80] = 80 # Maksymalny wiek 80

    # 3. Płeć (kategorystyczna, dyskretna)
    genders = ["M", "K"]
    data["Płeć"] = np.random.choice(genders, size=num_rows, p=[0.55, 0.45])

    # 4. Miasto (kategorystyczna, z brakami danych)
    cities = ["Warszawa", "Kraków", "Gdańsk", "Wrocław", "Poznań", "Katowice", np.nan]
    data["Miasto"] = np.random.choice(cities, size=num_rows, p=[0.2, 0.15, 0.1, 0.1, 0.1, 0.1, 0.25])

    # 5. Liczba_Dzieci (skokowa, całkowita)
    data["Liczba_Dzieci"] = np.random.randint(0, 5, size=num_rows)

    # 6. Przychód (ciągła, z dużą wariancją, z outlierami)
    data["Przychód"] = np.random.normal(loc=5000, scale=2000, size=num_rows)
    # Dodaj trochę outlierów
    outlier_indices = np.random.choice(num_rows, int(num_rows * 0.01), replace=False)
    data["Przychód"][outlier_indices] = np.random.normal(loc=20000, scale=5000, size=len(outlier_indices))
    data["Przychód"][data["Przychód"] < 0] = 100 # Minimalny przychód
    data["Przychód"] = data["Przychód"].round(2)

    # 7. Czy_Aktywny (binarna)
    data["Czy_Aktywny"] = np.random.choice([True, False], size=num_rows, p=[0.7, 0.3])

    # 8. Data_Rejestracji (data)
    start_date = pd.to_datetime("2020-01-01")
    end_date = pd.to_datetime("2023-12-31")
    date_range = (end_date - start_date).days
    data["Data_Rejestracji"] = [start_date + pd.Timedelta(days=random.randint(0, date_range)) for _ in range(num_rows)]

    # 9. Opis (tekstowa, z brakami danych i różnymi długościami)
    descriptions = [
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
        "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        "", # Pusty opis
        np.nan # Brak danych
    ]
    data["Opis"] = np.random.choice(descriptions, size=num_rows, p=[0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.1])


    df = pd.DataFrame(data)

    # Zapisz do CSV
    df.to_csv(filename, index=False, encoding='utf-8')
    print(f"Wygenerowano plik '{filename}' z {num_rows} wierszami.")

if __name__ == "__main__":
    # Generowanie małego pliku (100 wierszy)
    generate_sample_csv("small_sample_data.csv", num_rows=100)
    
    # Generowanie większego pliku (10,000 wierszy)
    generate_sample_csv("large_sample_data.csv", num_rows=10000)