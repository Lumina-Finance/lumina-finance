"""The start-up step checking both database keys, shared by the app and the bank sync worker

It lives apart from the other start-up steps, since their module loads the sign-in signing keys. A worker
container is never given those keys. It is a point in app.extension that code outside the app can run alone
"""

from app.database import engine
from app.db.bank_transaction_key import verify_key_matches_hashes
from app.db.encryption_key import verify_key_matches_data


async def verify_database_keys() -> None:
    """Fail startup unless the encryption key and the bank transaction hash key are the ones the database was made with

    The OIDC seeding rewrites the client secret under whatever key resolved, so a process holding the
    wrong one would mix two keys inside that column. The container entrypoint checks this too, and the
    app's lifespan runs this step before the seeding. Code serving the app without the lifespan gets the
    check only by running this step itself
    """
    async with engine.connect() as connection:
        await verify_key_matches_data(connection)

        # A missing key would refuse every OFX import, and another key than the hashes were made
        # with would let every statement imported again bring back what is already saved
        await verify_key_matches_hashes(connection)
