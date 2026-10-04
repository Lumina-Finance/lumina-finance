"""Bank sync: provider adapters and the stored state the sync engine keeps

The adapters share an outbound request guard. The stored state comes with the rules that read it
and the queueing of sync jobs
"""
