def greet(name):
    """
    Ta funkcja przyjmuje imię jako argument i zwraca spersonalizowane powitanie.
    """
    return f"Witaj, {name}! Miłego dnia."

if __name__ == "__main__":
    user_name = "Użytkowniku"
    greeting_message = greet(user_name)
    print(greeting_message)