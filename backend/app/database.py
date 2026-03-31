from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import DATABASE_URL

engine = create_async_engine(DATABASE_URL)

# expire_on_commit=False keeps objects usable after commit without re-fetching
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    """Yield an async database session for use as a FastAPI dependency.

    Yields:
        An AsyncSession that is automatically closed when the request completes.
    """
    async with async_session() as session:
        yield session
