# -*- coding: utf-8 -*-
"""低分产品统计演示数据（内置）

仅作为内存数据源：服务启动时由 low_star_service.seed_demo_low_star 解析并
写入数据库（low_star_listings / low_star_snapshots，按演示租户隔离）。
接口只从数据库按 tenant_id 读取，不再读取任何 CSV/JSON 文件。
"""

DEMO_CSV = """sid,店铺名,seller_sku,asin,last_star,price,currency_code,status,item_name
136,TechGuard-US,D6-USA-E-001,D6B0FCXPJZS1,2.8,19.99,USD,1,"Magnetic Case for iPhone 15 Pro, Shockproof Slim Cover with MagSafe Ring, Clear"
137,TechGuard-UK,D6-UK-A-001,D6B0FCXPJZS2,1.9,18.99,GBP,1,"Magnetic Clear Case for iPhone 15 Pro, Anti-Yellowing Slim Protective Cover"
138,TechGuard-AU,D6-AU-B-001,D6B0FCXPJZS3,2.6,35.99,AUD,1,"65W GaN Fast Charger, 3-Port USB-C Wall Adapter for Laptop and Phone"
139,TechGuard-CA,D6-CA-A-001,D6B0FCXPJZS4,1.4,32.99,CAD,1,"65W USB C Charger Block, Compact Foldable Travel Adapter, 2 USB-C + 1 USB-A"
136,TechGuard-US,D6-HSR-001,D6B0FCXPJZS5,2.2,29.99,USD,1,"65W GaN Charger with USB-C Cable, Fast Charging for MacBook Air and iPhone"
137,TechGuard-UK,D6-UK-C-001,D6B0FCXPJZS6,0.9,9.99,GBP,1,"Silicone Case for AirPods Pro 2, Shock-Absorbing Protective Cover with Keychain"
136,TechGuard-US,D6-USA-C-001,D6B0FCXPJZS7,3.0,12.49,USD,1,"AirPods Pro 2 Case Cover, Soft Silicone Skin with Carabiner, Front LED Visible"
136,TechGuard-US,D6-USA-L-001,D6B0FCXPJZS8,2.4,16.99,USD,1,"Paperfeel Screen Protector for iPad Air 5, Matte Film for Drawing and Writing"
137,TechGuard-UK,D6-UK-L-001,D6B0FCXPJZS9,1.2,15.99,GBP,0,"Matte Screen Protector for iPad Air 5th Gen, Anti-Glare Paper Texture Film"
136,TechGuard-US,D6-USA-R-001,D6B0FCXPJZ10,2.9,27.99,USD,1,"USB-C Hub 6-in-1 with HDMI 4K, USB 3.0, SD Card Reader for MacBook Pro"
137,TechGuard-UK,D6-UK-U-001,D6B0FCXPJZ11,2.1,21.99,GBP,1,"MagSafe Car Mount Holder, Magnetic Air Vent Phone Stand for iPhone 15/14"
136,TechGuard-US,D6-USA-S-001,D6B0FCXPJZ12,1.7,33.99,USD,1,"10000mAh Magnetic Power Bank, Wireless Portable Charger with USB-C PD 20W"
138,TechGuard-AU,D6-AU-O-001,D6B0FCXPJZ13,2.7,24.99,AUD,1,"Braided Solo Loop Band for Apple Watch Ultra 2/49mm, Stretchable Sport Strap"
136,TechGuard-US,D6-USA-E-014,D6B0FCXPJZ14,3.0,14.99,USD,1,"iPhone 15 Pro Case with 2 Pack Tempered Glass Screen Protectors, Clear"
137,TechGuard-UK,D6-UK-E-015,D6B0FCXPJZ15,1.5,11.99,GBP,1,"USB-C to USB-C Cable 2-Pack 6ft, 60W Fast Charging Nylon Braided"
138,TechGuard-AU,D6-AU-E-016,D6B0FCXPJZ16,2.3,8.99,AUD,1,"Screen Protector Installation Kit, Alignment Frame with Dust Removal Stickers"
"""
