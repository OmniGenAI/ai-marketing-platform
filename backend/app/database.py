from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
# from sqlalchemy.pool import NullPool
from dotenv import load_dotenv
import os

# Load environment variables from .env
load_dotenv()


# Create the SQLAlchemy engine
engine = create_engine(os.getenv("DATABASE_URL"))

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

# Test the connection
try:
    with engine.connect() as connection:
        print("Connection successful!")
except Exception as e:
    print(f"Failed to connect: {e}")
    
def get_db():
    """Provide a transactional scope around a series of operations."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

