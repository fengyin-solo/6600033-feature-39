import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.orm import Session

from .database import Base, get_db

MAX_SUMMARY = 256
MAX_TITLE = 128


class Record(Base):
    __tablename__ = "records"

    id = Column(Integer, primary_key=True, index=True)
    record_type = Column(String(16), index=True)
    title = Column(String(MAX_TITLE))
    summary = Column(String(MAX_SUMMARY))
    params = Column(Text, default="{}")
    result = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class RecordCreate(BaseModel):
    record_type: str
    title: str
    summary: str
    params: dict[str, Any] = {}
    result: dict[str, Any] = {}


class RecordSummary(BaseModel):
    id: int
    record_type: str
    title: str
    summary: str
    created_at: datetime

    class Config:
        from_attributes = True


class RecordDetail(RecordSummary):
    params: dict[str, Any]
    result: dict[str, Any]


router = APIRouter(prefix="/api/history", tags=["history"])


def _to_detail(r: Record) -> RecordDetail:
    return RecordDetail(
        id=r.id,
        record_type=r.record_type,
        title=r.title,
        summary=r.summary,
        created_at=r.created_at,
        params=json.loads(r.params) if r.params else {},
        result=json.loads(r.result) if r.result else {},
    )


@router.post("", response_model=RecordDetail, status_code=201)
def create_record(payload: RecordCreate, db: Session = Depends(get_db)):
    record = Record(
        record_type=payload.record_type[:16],
        title=payload.title[:MAX_TITLE],
        summary=payload.summary[:MAX_SUMMARY],
        params=json.dumps(payload.params, ensure_ascii=False),
        result=json.dumps(payload.result, ensure_ascii=False),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _to_detail(record)


@router.get("", response_model=list[RecordSummary])
def list_records(db: Session = Depends(get_db)):
    rows = db.query(Record).order_by(Record.created_at.desc()).all()
    return [RecordSummary.model_validate(r) for r in rows]


@router.get("/{record_id}", response_model=RecordDetail)
def get_record(record_id: int, db: Session = Depends(get_db)):
    r = db.query(Record).filter(Record.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    return _to_detail(r)


@router.delete("/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)):
    r = db.query(Record).filter(Record.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(r)
    db.commit()
    return {"ok": True, "id": record_id}
