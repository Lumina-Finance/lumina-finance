"""Seed the merchants table with global system merchants"""

from app.db.seeds import run_seeds

if __name__ == "__main__":
    run_seeds(["merchants"])
