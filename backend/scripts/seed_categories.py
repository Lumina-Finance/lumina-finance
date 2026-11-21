"""Seed the categories table with global system categories"""

from app.db.seeds import run_seeds

if __name__ == "__main__":
    run_seeds(["categories"])
