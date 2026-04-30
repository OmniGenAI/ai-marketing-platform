from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import QueuePool
from sqlalchemy.exc import OperationalError
from dotenv import load_dotenv
import logging
import os

load_dotenv()

logger = logging.getLogger(__name__)

database_url = os.getenv("DATABASE_URL")

engine = create_engine(
    database_url,
    poolclass=QueuePool,
    pool_size=2,
    max_overflow=3,
    pool_pre_ping=True,
    pool_recycle=240,   # 4 min — under PgBouncer's ~5 min idle timeout
    pool_timeout=30,
    connect_args={
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
        "application_name": "ai-marketing-platform",
    },
)


@event.listens_for(engine, "handle_error")
def handle_db_error(exception_context):
    """Invalidate stale connections on SSL/network errors."""
    orig = (
        getattr(exception_context.original_exception, "__cause__", None)
        or exception_context.original_exception
    )
    msg = str(orig).lower()
    if any(k in msg for k in ("ssl", "eof", "connection", "closed", "broken pipe")):
        logger.warning(f"[DB] Invalidating stale connection: {orig}")
        exception_context.invalidate_pool_on_disconnect = True
        exception_context.is_disconnect = True


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


try:
    with engine.connect() as connection:
        print("✅ Connection successful!")
except Exception as e:
    print(f"❌ Failed to connect: {e}")


def get_db():
    db = SessionLocal()
    try:
        yield db
    except OperationalError as e:
        msg = str(e).lower()
        if any(k in msg for k in ("ssl", "eof", "connection", "closed")):
            logger.warning(f"[DB] Swallowing stale-connection error: {e}")
        else:
            raise
    finally:
        try:
            db.close()
        except Exception as e:
            logger.warning(f"[DB] Error during session close (ignored): {e}")

