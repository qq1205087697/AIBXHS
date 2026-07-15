from database.database import SessionLocal
from models.product_page_info import ProductPageInfo
from models.user import User
from routers.product_page_info import calc_total_score, calc_star_rating_score, calc_competitor_price_score

db = SessionLocal()

# 查询admin用户的tenant_id
admin = db.query(User).filter(User.username == "admin").first()
print(f"Admin tenant_id: {admin.tenant_id if admin else 'None'}")

# 查询已评分记录
rated = db.query(ProductPageInfo).filter(ProductPageInfo.rating_status == 1).all()
print(f"已评分记录总数: {len(rated)}")

if admin:
    tenant_rated = db.query(ProductPageInfo).filter(
        ProductPageInfo.rating_status == 1,
        ProductPageInfo.tenant_id == admin.tenant_id
    ).limit(3).all()
    print(f"Admin tenant已评分记录数: {len(tenant_rated)}")
    
    if tenant_rated:
        print("\n计算前3条的总分:")
        for item in tenant_rated:
            star_score = calc_star_rating_score(item.star_rating)
            _, competitor_score = calc_competitor_price_score(item.price, item.competitor_price)
            has_ad_val = item.has_ad if item.has_ad is not None else False
            has_aplus_val = item.has_aplus if item.has_aplus is not None else 0
            has_video_val = item.has_video if item.has_video is not None else False
            
            total = calc_total_score(
                item.title_rating,
                item.description_rating,
                item.keywords_rating,
                item.image_rating,
                star_score,
                has_ad_val,
                has_aplus_val,
                has_video_val,
                competitor_score,
            )
            print(f"  SKU: {item.sku}, total_score: {total}, star_rating: {item.star_rating}")

db.close()