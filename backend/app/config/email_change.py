"""Email change link lifetime"""

# A confirmation link only has to outlast the time to open a mailbox, and it decides which address an
# account signs in with, so it is as short-lived as a password reset link
EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS = 15 * 60
