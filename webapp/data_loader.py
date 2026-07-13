# -*- coding: utf-8 -*-
"""CSV 데이터를 메모리에 올려서 API가 바로 조회할 수 있게 준비.
데이터 규모가 작아(회사 백여 개, 재무 수천 행) DB 없이 pandas로 충분함."""

from pathlib import Path

import pandas as pd

from ratios import INDUSTRY_CONFIG

DATA_DIR = Path(__file__).parent / "data"
FS_DIV_PRIORITY = {"CFS": 0, "OFS": 1}

INDUSTRY_LABELS = {
    "defense": "방산",
    "semiconductor": "반도체",
    "construction": "건설",
}


def _read_csv(name: str) -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / name, dtype=str, keep_default_na=False)


def _parse_amount(s: str):
    s = (s or "").strip()
    if s == "" or s == "-":
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def build_ratios(financials_df: pd.DataFrame, companies: pd.DataFrame) -> dict:
    """업종별 계정과목 -> 회사×연도별 재무비율 표로 변환.

    매출액증가율/재고자산증가율/재고자산·매출채권 회전일수처럼 전기(직전연도) 값과
    비교해야 하는 지표는, 같은 회사(corp_code)의 직전 반복(연도가 1 작은 경우)에서
    계산해 둔 값을 prev_by_corp에 캐시해뒀다가 이어붙이는 방식으로 처리한다.
    (groupby(["corp_code","year"])는 기본적으로 corp_code -> year 오름차순으로
    정렬되어 나오므로, 같은 회사는 연도 순서대로 순회된다.)
    """
    financials_df = financials_df.copy()
    financials_df["amount_num"] = financials_df["amount"].apply(_parse_amount)
    financials_df["_prio"] = financials_df["fs_div"].map(FS_DIV_PRIORITY).fillna(2)

    # 회사 목록 자체엔 손대지 않되(중복 행 그대로 유지), 조회용으로만 corp_code 중복 제거
    name_lookup = (
        companies.drop_duplicates(subset="corp_code", keep="first")
        .set_index("corp_code")[["corp_name", "stock_code"]]
        .to_dict("index")
    )

    ratios_by_industry = {}
    for industry_id, config in INDUSTRY_CONFIG.items():
        sub = financials_df[financials_df["industry_id"] == industry_id]
        rows = []
        prev_by_corp = {}  # corp_code -> 직전에 계산한 연도의 computed dict(+_year)
        for (corp_code, year), group in sub.sort_values("_prio").groupby(["corp_code", "year"]):
            acc = {}
            for _, r in group.iterrows():
                acc.setdefault(r["account_name"], r["amount_num"])

            computed = config["compute"](acc)

            prev = prev_by_corp.get(corp_code)
            if prev is not None and int(year) - prev["_year"] == 1:
                rev, prev_rev = computed.get("revenue"), prev.get("revenue")
                if rev is not None and prev_rev:
                    computed["revenueGrowth"] = (rev - prev_rev) / prev_rev * 100

                inv, prev_inv = computed.get("_inv"), prev.get("_inv")
                if inv is not None and prev_inv:
                    computed["invGrowth"] = (inv - prev_inv) / prev_inv * 100
                if inv is not None and prev_inv is not None:
                    cogs = computed.get("_cogs")
                    if cogs:
                        computed["invDays"] = (inv + prev_inv) / 2 / cogs * 365

                ar, prev_ar = computed.get("_ar"), prev.get("_ar")
                if ar is not None and prev_ar is not None and rev:
                    computed["arDays"] = (ar + prev_ar) / 2 / rev * 365

            # 다음 연도 계산에서 "전기값"으로 쓸 수 있도록 raw 필드까지 포함해 캐시
            prev_by_corp[corp_code] = {**computed, "_year": int(year)}

            # API로 내보내는 값에선 내부 계산용 raw 필드(_로 시작) 제거
            for k in [k for k in computed if k.startswith("_")]:
                computed.pop(k, None)

            info = name_lookup.get(corp_code, {})
            corp_name = info.get("corp_name") or group["corp_name"].iloc[0]
            stock_code = info.get("stock_code") or group["stock_code"].iloc[0]
            rows.append({
                "corp_code": corp_code,
                "corp_name": corp_name,
                "stock_code": stock_code,
                "year": year,
                **computed,
            })
        ratios_by_industry[industry_id] = pd.DataFrame(rows)

    return ratios_by_industry


def _normalize_corp_code(series: pd.Series) -> pd.Series:
    """DART corp_code는 항상 8자리 숫자인데, 파일마다 앞자리 0이 잘려 있는 경우가
    있어(엑셀에서 숫자로 저장되는 등) 조인이 깨짐 - 8자리로 재정렬"""
    stripped = series.str.strip()
    return stripped.where(stripped == "", stripped.str.zfill(8))


def load_data():
    companies = _read_csv("companies_basic.csv")
    companies["corp_code"] = _normalize_corp_code(companies["corp_code"])
    # 데이터 생성 과정에서 신원 정보가 통째로 비어버린 깨진 행 제외
    companies = companies[companies["corp_code"] != ""].copy()

    industry_map = _read_csv("industry_map.csv")
    industry_map["corp_code"] = _normalize_corp_code(industry_map["corp_code"])
    industry_map = industry_map[industry_map["corp_code"] != ""].copy()

    financials = []
    for industry_id in ("defense", "semiconductor", "construction"):
        df = _read_csv(f"{industry_id}.csv")
        df["corp_code"] = _normalize_corp_code(df["corp_code"])
        df = df[df["corp_code"] != ""].copy()
        df["industry_id"] = industry_id
        financials.append(df)
    financials_df = pd.concat(financials, ignore_index=True)

    # construction은 industry_map에 아직 없어서, 재무 데이터에 등장하는 것만으로 보강
    existing_pairs = set(zip(industry_map["corp_code"], industry_map["industry_id"]))
    construction_codes = financials_df.loc[
        financials_df["industry_id"] == "construction", "corp_code"
    ].unique()
    extra_rows = []
    for code in construction_codes:
        if (code, "construction") not in existing_pairs:
            row = companies.loc[companies["corp_code"] == code]
            corp_name = row["corp_name"].iloc[0] if len(row) else ""
            stock_code = row["stock_code"].iloc[0] if len(row) else ""
            extra_rows.append({
                "corp_code": code,
                "stock_code": stock_code,
                "corp_name": corp_name,
                "industry_id": "construction",
                "is_primary": "TRUE",
                "level": "B",
                "level_category": "주요기업",
                "memo": "",
                "updated_at": "",
            })
    if extra_rows:
        industry_map = pd.concat([industry_map, pd.DataFrame(extra_rows)], ignore_index=True)

    # 회사별로 속한 산업 목록을 companies_basic에 합쳐 넣음
    industries_by_corp = (
        industry_map.groupby("corp_code")
        .apply(
            lambda g: [
                {
                    "industry_id": r["industry_id"],
                    "industry_label": INDUSTRY_LABELS.get(r["industry_id"], r["industry_id"]),
                    "level": r["level"],
                    "level_category": r["level_category"],
                    "is_primary": r["is_primary"] == "TRUE",
                }
                for _, r in g.iterrows()
            ],
            include_groups=False,
        )
        .to_dict()
    )
    companies["industries"] = companies["corp_code"].map(
        lambda c: industries_by_corp.get(c, [])
    )

    ratios_by_industry = build_ratios(financials_df, companies)

    return {
        "companies": companies,
        "industry_map": industry_map,
        "financials": financials_df,
        "ratios": ratios_by_industry,
    }
