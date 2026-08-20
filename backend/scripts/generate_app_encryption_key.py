"""Print a new application encryption key for an operator to store"""

from app.encryption import generate_encryption_key


def main() -> None:
    """Print a new key without persisting it or touching the database

    Printing is safe here because the key protects nothing yet, unlike the rotation, which
    prints no secret at all. An operator who loses this one simply generates another
    """
    print(generate_encryption_key())


if __name__ == "__main__":
    main()
