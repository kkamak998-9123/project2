# -*- coding: utf-8 -*-
"""Samil Project DB 웹앱: 업종별 재무비율 검색/대시보드 API + 정적 프론트엔드"""

from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from data_loader import load_data
from ratios import INDUSTRY_CONFIG

app = FastAPI(title="Samil Project DB")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA = load_data()


def _cols_payload(cols):
    return [{"key": k, "label": label, "unit": unit} for k, label, unit in cols]


def _clean(records):
    for r in records:
        for k, v in r.items():
            if isinstance(v, float) and pd.isna(v):
                r[k] = None
    return records


@app.get("/api/industries")
def list_industries():
    return [
        {
            "id": industry_id,
            "label": cfg["label"],
            "note": cfg["note"],
            "table_cols": _cols_payload(cfg["table_cols"]),
        }
        for industry_id, cfg in INDUSTRY_CONFIG.items()
    ]


@app.get("/api/ratios")
def list_ratios(
    industry: str = Query(..., description="defense/semiconductor/construction"),
    year: str = Query(...),
    q: str = Query(""),
):
    if industry not in INDUSTRY_CONFIG:
        raise HTTPException(status_code=404, detail="알 수 없는 산업입니다")

    df = DATA["ratios"][industry]
    df = df[df["year"] == year]
    if q:
        df = df[df["corp_name"].str.contains(q, case=False, na=False)]

    table_keys = [k for k, _, _ in INDUSTRY_CONFIG[industry]["table_cols"]]
    cols = ["corp_code", "stock_code", "corp_name"] + table_keys
    records = df[cols].to_dict("records")

    revenue_vals = df["revenue"].dropna()
    opm_vals = df["opm"].dropna() if "opm" in df.columns else pd.Series(dtype=float)
    profitable = int((df["opinc"] > 0).sum()) if "opinc" in df.columns else None

    kpi = {
        "count": len(df),
        "total_revenue": float(revenue_vals.sum()) if len(revenue_vals) else None,
        "median_opm": float(opm_vals.median()) if len(opm_vals) else None,
        "profitable_count": profitable,
    }

    return {"count": len(records), "items": _clean(records), "kpi": kpi}


@app.get("/api/ratios/{industry}/{corp_code}")
def get_ratio_detail(industry: str, corp_code: str):
    if industry not in INDUSTRY_CONFIG:
        raise HTTPException(status_code=404, detail="알 수 없는 산업입니다")

    df = DATA["ratios"][industry]
    rows = df[df["corp_code"] == corp_code].sort_values("year")
    if rows.empty:
        raise HTTPException(status_code=404, detail="재무비율 데이터가 없습니다")

    cfg = INDUSTRY_CONFIG[industry]
    all_keys = ["revenue"] + [k for k, _, _ in cfg["table_cols"]] + [k for k, _, _ in cfg["detail_cols"]]
    all_keys = list(dict.fromkeys(all_keys))  # 순서 유지 중복 제거

    years = rows["year"].tolist()
    series = {k: _clean([{"v": v} for v in rows[k].tolist()]) for k in all_keys if k in rows.columns}
    series = {k: [r["v"] for r in v] for k, v in series.items()}

    latest = rows.iloc[-1]
    latest_values = {k: (None if pd.isna(latest[k]) else latest[k]) for k in all_keys if k in rows.columns}

    return {
        "corp_code": corp_code,
        "corp_name": latest["corp_name"],
        "stock_code": latest["stock_code"],
        "years": years,
        "series": series,
        "latest": latest_values,
        "table_cols": _cols_payload(cfg["table_cols"]),
        "detail_cols": _cols_payload(cfg["detail_cols"]),
        "sparks": _cols_payload(cfg["sparks"]),
        "note": cfg["note"],
    }


static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
