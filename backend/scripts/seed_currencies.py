"""Seed the currencies table with ISO 4217 data"""

from app.db.seeds import run_seeds

if __name__ == "__main__":
    run_seeds(["currencies"])
