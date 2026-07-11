"""Firefly III export importer

Converts journal rows from a Firefly III data export into Lumina
transactions. Firefly III uses double-entry accounting where every journal
moves money between two accounts, so rows resolve to one Lumina transaction
when the counterparty is an expense or revenue account, and to a two-leg
transfer when both endpoints are imported asset or liability accounts
"""
