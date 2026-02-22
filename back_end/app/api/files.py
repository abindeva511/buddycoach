from fastapi import APIRouter, UploadFile, Depends, File as FastAPIFile
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.file import File
from app.utils.s3 import upload_file

router = APIRouter(prefix="/files", tags=["files"])

@router.post("")
def upload(user=Depends(get_current_user), db: Session = Depends(get_db), file: UploadFile = FastAPIFile(...)):

    key = upload_file(file.file, user.id, file.filename)

    db_file = File(
        user_id=user.id,
        original_filename=file.filename,
        s3_key=key,
        file_size=file.size if file.size is not None else file.file.seek(0, 2)
    )

    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    return {"id": db_file.id, "filename": db_file.original_filename}
