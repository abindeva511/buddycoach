from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt, JWTError
from pydantic import BaseModel
from app.db.session import get_db
from app.models.user import User
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

class RefreshTokenRequest(BaseModel):
    refresh_token: str

@router.post("/register")
def register(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    if db.query(User).filter_by(username=form.username).first():
        raise HTTPException(400, "Username already exists")

    user = User(
        username=form.username,
        password_hash=hash_password(form.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username}

@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "refresh_expires_in": settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    }

@router.post("/refresh-token")
def refresh_token(payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    try:
        token_payload = jwt.decode(
            payload.refresh_token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if token_payload.get("token_type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = token_payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = db.get(User, int(user_id))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access_token = create_access_token({"sub": str(user.id)})
    return {
        "access_token": new_access_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }
