"""Bank sync: provider adapters and the stored state the sync engine keeps

The adapters share an outbound request guard. The stored state comes with the rules that read it
and the queueing of sync jobs. The worker claims and runs them as each job's owner. Which providers
a deployment offers and which accounts can take a bank account are decided in one place, the
availability module
"""
