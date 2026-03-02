import boto3
from uuid import uuid4
from app.core.config import settings

s3 = boto3.client(
    "s3",
    aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    region_name=settings.AWS_REGION,
)

def upload_file(file_obj, user_id: int, filename: str):
    key = f"uploads/{user_id}/{uuid4()}_{filename}"
    s3.upload_fileobj(file_obj, settings.AWS_S3_BUCKET, key)
    return key

def download_file(key: str) -> bytes:
    return s3.get_object(Bucket=settings.AWS_S3_BUCKET, Key=key)["Body"].read()


def upload_bytes(
    data: bytes,
    user_id: int,
    filename: str,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload raw bytes to S3 and return the object key."""
    key = f"results/{user_id}/{uuid4()}_{filename}"
    s3.put_object(
        Bucket=settings.AWS_S3_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key