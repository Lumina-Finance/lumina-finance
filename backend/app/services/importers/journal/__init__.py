"""Journal importer, shared by the Firefly III and Actual Budget imports

Converts journal rows the import screen compiles from either export into
Lumina transactions. Every journal moves money between two endpoints, so rows
resolve to one Lumina transaction when the counterparty is a payee, and to a
two-leg transfer when both endpoints are imported asset or liability accounts
"""
