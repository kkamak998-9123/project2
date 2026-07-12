# -*- coding: utf-8 -*-
"""Samil Project DB 웹앱: 기업 검색/필터 + 재무 대시보드용 API + 정적 프론트엔드"""

from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from data_loader import load_data

app = FastAPI(title="Samil Project DB")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA = load_data()


def _nan_to_none(records):
    for r in records:
        for k, v in r.items():
            if isinstance(v, float) and pd.isna(v):
                r[k] = None
    return records


@app.get("/api/meta")
def get_meta():
    companies = DATA["companies"]
    industries = sorted({
        ind["industry_id"]
        for row in companies["industries"]
        for ind in row
    })
    markets = sorted(m for m in companies["market"].unique() if m)
    levels = sorted({
        ind["level"]
        for row in companies["industries"]
        for ind in row
    })
    industry_counts = {i: 0 for i in industries}
    for row in companies["industries"]:
        for ind in row:
            industry_counts[ind["industry_id"]] += 1

    return {
        "industries": industries,
        "markets": markets,
        "levels": levels,
        "industry_counts": industry_counts,
        "total_companies": int(len(companies)),
    }


@app.get("/api/companies")
def list_companies(
    q: str = Query("", description="회사명/메모 검색어"),
    industry: str = Query("", description="defense/semiconductor/construction"),
    market: str = Query(""),
    level: str = Query(""),
):
    df = DATA["companies"]

    if industry:
        df = df[df["industries"].apply(
            lambda inds: any(i["industry_id"] == industry for i in inds)
        )]
    if level:
        df = df[df["industries"].apply(
            lambda inds: any(i["level"] == level for i in inds)
        )]
    if market:
        df = df[df["market"] == market]
    if q:
        mask = (
            df["corp_name"].str.contains(q, case=False, na=False)
            | df["memo"].str.contains(q, case=False, na=False)
            | df["ksic_name"].str.contains(q, case=False, na=False)
        )
        df = df[mask]

    cols = [
        "corp_code", "stock_code", "corp_name", "market",
        "ksic_code", "ksic_name", "memo", "industries",
        "수익인식 코드", "분류",
    ]
    records = df[cols].to_dict("records")
    return {"count": len(records), "items": _nan_to_none(records)}


@app.get("/api/companies/{corp_code}")
def get_company(corp_code: str):
    df = DATA["companies"]
    row = df[df["corp_code"] == corp_code]
    if row.empty:
        raise HTTPException(status_code=404, detail="회사를 찾을 수 없습니다")
    return _nan_to_none(row.to_dict("records"))[0]


@app.get("/api/financials/{corp_code}")
def get_financials(corp_code: str):
    fin = DATA["financials"]
    rows = fin[fin["corp_code"] == corp_code]
    if rows.empty:
        return {"count": 0, "items": []}

    cols = ["industry_id", "year", "fs_div", "sj_div", "account_name", "amount", "memo"]
    records = rows[cols].to_dict("records")

    # 연도별 매출액/영업이익 등 핵심 지표만 뽑아 차트용으로 별도 제공
    KEY_ACCOUNTS = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "영업활동현금흐름"]
    chart_rows = rows[rows["account_name"].isin(KEY_ACCOUNTS)].copy()
    chart_rows["amount_num"] = pd.to_numeric(
        chart_rows["amount"].str.replace(",", ""), errors="coerce"
    )
    chart = (
        chart_rows.groupby(["year", "account_name"])["amount_num"]
        .mean()
        .reset_index()
        .to_dict("records")
    )

    return {"count": len(records), "items": records, "chart": _nan_to_none(chart)}


static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
