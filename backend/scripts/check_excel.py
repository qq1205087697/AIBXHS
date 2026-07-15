"""检查结果.xlsx中B07WHGXBNB的父汇总行"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

def main():
    file_path = "c:\\Users\\Administrator\\Desktop\\AI\\AIBXHS\\结果.xlsx"
    df = pd.read_excel(file_path)

    # 查看列名
    print(f"列数: {len(df.columns)}")
    print(f"行数: {len(df)}")

    # 查找 B07WHGXBNB
    # 先找 asin 列
    asin_col = None
    for col in df.columns:
        if 'ASIN' in str(col) or 'asin' in str(col).lower():
            asin_col = col
            break

    if asin_col:
        mask = df[asin_col].astype(str).str.contains('B07WHGXBNB', na=False)
        subset = df[mask]
        print(f"\nB07WHGXBNB 相关行: {len(subset)} 条")

        # 找 summary_flag 列
        summary_col = None
        for col in df.columns:
            if '汇总' in str(col) or '欧洲' in str(col) or '北美' in str(col):
                summary_col = col
                break

        # 找 country 列
        country_col = None
        for col in df.columns:
            if '国家' in str(col) or 'country' in str(col).lower():
                country_col = col
                break

        # 找 account 列
        acc_col = None
        for col in df.columns:
            if '店铺' in str(col) or 'account' in str(col).lower():
                acc_col = col
                break

        print(f"\n列名: {list(subset.columns[:15])}")
        for _, row in subset.iterrows():
            summary = row.get(summary_col, '') if summary_col else ''
            country = row.get(country_col, '') if country_col else ''
            acc = row.get(acc_col, '') if acc_col else ''
            print(f"\n  summary_flag={summary}")
            print(f"  country={country}")
            print(f"  account={str(acc)[:60]}...")
    else:
        print("未找到 ASIN 列")
        print(f"列名: {list(df.columns[:20])}")

if __name__ == "__main__":
    main()