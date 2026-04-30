from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import QueuePool
from dotenv import load_dotenv
import os

# Load environment variables from .env
load_dotenv()

database_url = os.getenv("DATABASE_URL")

# Create the SQLAlchemy engine with proper pooling for PgBouncer
engine = create_engine(
    database_url,
    poolclass=QueuePool,
    pool_size=2,  # PgBouncer limits connections, use smaller pool
    max_overflow=3,
    pool_pre_ping=True,  # Test connections before reusing
    pool_recycle=300,  # Recycle connections every 5 minutes for PgBouncer
    connect_args={
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
    }
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

# Test the connection
try:
    with engine.connect() as connection:
        print("✅ Connection successful!")
except Exception as e:
    print(f"❌ Failed to connect: {e}")
    
def get_db():
    """Provide a transactional scope around a series of operations."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

