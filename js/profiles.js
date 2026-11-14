// ============================================================
//  ZOS-R · 个体固有属性（纯函数，零依赖）
//
//  姓名 / 年龄 / 性别 / 职业 / 家庭 —— 全部由「个体下标 + 盐」哈希决定，
//  所以同一个人在模拟里、在档案里、在总览表里永远是同一份资料。
//
//  这个模块**不能 import 任何东西**：sim.js 和 people.js 都要用它，
//  引入依赖会成环。
// ============================================================

// ---------------- 姓名池：按城市所在国家切换 ----------------
// 显示一律用中文（日本人名也用汉字，如 佐藤 健太）。
// 这个模块不能 import 任何东西（sim.js 和 people.js 都用它，会成环），
// 所以国家由启动时 setCountry() 注入一次。
// 名字用「姓池 × 名池」组合，池子越大越不容易撞名。

const splitChars = (s) => s.split('').filter((c) => c.trim());
const splitWords = (s) => s.trim().split(/\s+/);

// ===== 中国 =====
// 姓：百家姓前 400 多个常用姓氏
const CN_LAST = splitChars(
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤' +
  '常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路游辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂全佟应臧闵苟邬边卞姬师和仇栾隋商刁沙荣巫寇桑郎甄丛仲虞敖巩明佘池查麻苑迟邝'
);
// 名的首字 / 次字（组合出 60×80 = 4800 个双字名）
const CN_A = splitChars('子浩思俊明嘉雨欣雅诗若语天梓文志心晨梦怡静永建振晓海春立新嘉德泽家国瑞锦玉清华安泰和');
const CN_B = splitChars(
  '涵然轩宇豪远清婷曦凡阳昭恒彤睿悦宁航博琪辉杰琳蕾薇菲楠鑫淼磊坤敏丽芳颖洁虹云霞文轩辰瑜璟璇璐澜波峰亮萍红梅兰竹松柏青云山川河洋涛鹏飞龙虎鹤麟'
);
const CN_M1 = splitChars('伟强磊军勇杰涛超刚明辉鹏华斌峰亮健旭鑫坤淼浩宁博宇轩睿恒阳晨海波立新建国志宇家豪俊文博昊阳毅鑫');
const CN_F1 = splitChars('芳娜敏静丽艳娟霞平燕英华玉兰珍梅玲莉萍红秀桂春凤素琴雪婷雯雅琳蕾薇颖洁莹怡欣悦宁');
const CN_M2 = splitWords(
  '浩然 子轩 宇轩 俊杰 嘉豪 思远 振宇 晓东 文博 家豪 志强 建国 立新 明远 天佑 晨曦 亦凡 沐阳 昭明 之恒 ' +
  '书豪 睿泽 梓豪 子墨 修远 承泽 景行 尚德 铭轩 星宇 泓博 澈明 弘文 承宇 致远 峻熙 昊然 天成 泽宇 启航 ' +
  '锦程 昌平 绍宇 建平 志明 国栋 家俊 德胜 永康 学军 卫东 俊熙 一鸣 云帆 景铄 昱辰 昊宇 若谷 慕白 松原'
);
const CN_F2 = splitWords(
  '雨欣 欣怡 婉清 雅婷 心怡 若曦 舒雅 语彤 思彤 佳怡 梦琪 诗涵 紫涵 语汐 一诺 安然 静姝 可欣 亦菲 婉婷 ' +
  '清悦 沐晴 星月 若彤 芷晴 心语 婉茹 雨桐 晨露 雪晴 静雯 书瑶 美琳 慧敏 秀珍 玉兰 春梅 丽娟 晓燕 淑芬 ' +
  '雅琴 月华 秋水 慕青 语嫣 静怡 文静 佩瑶 若雪 湘云 玉洁 春燕 秀兰 桂芳 素梅 惠兰 红霞 丽华 秀华 亚男'
);

// ===== 日本 =====
const JP_LAST = splitWords(
  '佐藤 铃木 高桥 田中 伊藤 渡边 山本 中村 小林 加藤 吉田 山田 佐佐木 山口 松本 井上 木村 清水 山崎 森田 ' +
  '池田 桥本 石川 前田 藤田 后藤 冈田 长谷川 村上 近藤 石井 坂本 远藤 青木 藤井 西村 福田 太田 三浦 藤原 ' +
  '冈本 松田 中川 中野 原田 小野 田村 竹内 金子 和田 中山 石田 上田 森下 柴田 酒井 工藤 横山 宫崎 宫本 ' +
  '内田 高木 安藤 谷口 大野 丸山 今井 河野 藤本 村田 武田 上野 杉山 増田 小岛 小山 平野 大西 北村 中田'
);
const JP_A = splitChars('健阳翔美拓由大真直智凉春悠结海葵龙咲和千隆绘俊美亮彩');
const JP_B = splitChars('太子太咲也美辅由树子介香斗衣斗介良也夏史里介穗太花太');
const JP_M2 = splitWords(
  '健太 翔太 拓也 大辅 直树 凉介 悠斗 海斗 龙之介 和也 隆史 俊介 亮太 优太 雄大 健一 达也 慎吾 ' +
  '一郎 太郎 次郎 三郎 幸雄 浩二 达夫 光一 裕太 雄一 良太 正人 和树 圭介 贵之 智之 春树 大地 航平 陆斗'
);
const JP_F2 = splitWords(
  '阳子 美咲 由美 真由 智子 春香 结衣 咲良 千夏 绘里 美穗 彩花 由佳 明日香 结子 真纪 佳奈 美咲 ' +
  '爱子 里奈 沙织 绘美 由纪 香织 亚美 桃子 七海 美羽 优花 莉子 结菜 花音 里绪 真绪 早纪 琴音 杏奈 美月'
);

// ===== 德国 =====
const DE_LAST = splitWords(
  '米勒 施密特 施耐德 费舍尔 韦伯 迈尔 瓦格纳 贝克尔 舒尔茨 霍夫曼 科赫 里希特 克莱因 沃尔夫 诺伊曼 施瓦茨 ' +
  '齐默尔曼 布劳恩 克鲁格 哈特曼 兰格 维尔纳 克劳斯 莱曼 舒马赫 福格尔 弗里德里希 京特 贝格 温克勒 ' +
  '约瑟夫 施泰因 雅各布斯 普法夫 凯泽 施特劳斯 胡贝尔 施赖伯 布兰特 默勒 阿尔布雷希特 施罗德 施泰纳 ' +
  '施陶赫 恩格尔 塞德尔 库恩 鲍尔 霍尔特 洛伦茨 弗兰克 施特姆 奥托 西蒙 鲍曼 施密茨 泽勒 施图尔姆'
);
const DE_M2 = splitWords(
  '卢卡斯 约纳斯 菲利克斯 保罗 本 托比亚斯 尼克拉斯 塞巴斯蒂安 莫里茨 马克西米利安 亚历克斯 埃米尔 ' +
  '汉斯 彼得 尤尔根 克劳斯 托马斯 米夏埃尔 安德烈亚斯 斯特凡 马蒂亚斯 弗兰克 沃尔夫冈 迪特 贝恩德 埃里希'
);
const DE_F2 = splitWords(
  '莱娜 安娜 玛丽 索菲 艾玛 克拉拉 尤利娅 汉娜 卡特琳 伊尔莎 莉亚 米娅 埃米莉 路易丝 玛蒂娜 施特菲 ' +
  '尤塔 扎比内 佩特拉 莫妮卡 安格拉 乌尔丽克 布里吉特 海克 比尔吉特 蕾娜特'
);

// ===== 英语系 =====
const EN_LAST = splitWords(
  '史密斯 约翰逊 威廉姆斯 布朗 琼斯 米勒 戴维斯 威尔逊 泰勒 克拉克 哈里斯 刘易斯 沃克 怀特 汤普森 安德森 ' +
  '杰克逊 托马斯 罗宾逊 爱德华兹 格林 霍尔 伍德 贝克 莫里斯 库克 摩根 库珀 贝利 里德 凯利 ' +
  '霍华德 米切尔 卡特 菲利普斯 特纳 帕克 柯林斯 斯图尔特 莫里森 里德 沃森 布鲁克 班尼特 格雷 詹姆斯'
);
const EN_M2 = splitWords(
  '杰克 威廉 詹姆斯 亨利 诺亚 奥利弗 乔治 哈里 汤姆 本 丹尼尔 约瑟夫 塞缪尔 马克斯 查理 亚瑟 ' +
  '托马斯 爱德华 彼得 安迪 查尔斯 弗雷德 尼古拉斯 罗伯特 史蒂文 大卫'
);
const EN_F2 = splitWords(
  '艾米莉 奥利维亚 索菲亚 艾拉 格蕾丝 莉莉 爱丽丝 露西 莎拉 凯特 米娅 伊芙 夏洛特 阿米莉亚 ' +
  '杰西卡 奥黛丽 苏菲 海伦 玛丽 琳达 艾玛 克莱尔 维多利亚 罗斯 黛西 汉娜'
);

// ===== 通用国际 =====
const IN_LAST = splitWords(
  '席尔瓦 桑托斯 奥利维拉 佩雷拉 科斯塔 德弗里斯 扬森 科瓦尔斯基 诺瓦克 雷耶斯 门多萨 卡瓦略 ' +
  '阿尔梅达 巴克 罗德里格斯 费尔南德斯 洛佩斯 马丁内斯 加西亚 佩雷斯 冈萨雷斯 巴蒂斯塔 ' +
  '阿卜杜拉 艾哈迈德 侯赛因 阿里 卡里姆 阮 陈 黎 潘 武 邓 范'
);
const IN_M2 = splitWords(
  '若昂 卡洛斯 路易斯 费尔南多 佩德罗 里卡多 米格尔 弗朗西斯科 彼得 马克思 阿里 哈桑 ' +
  '穆罕默德 奥马尔 阮文 陈明 阿米尔 约瑟夫 巴尔 内马尔 贝尔纳多 桑德罗'
);
const IN_F2 = splitWords(
  '玛丽亚 安娜 费尔南达 伊娃 妮娜 莱拉 法蒂玛 阿伊莎 阮氏 陈美 桑德拉 卡门 露西亚 宝拉 米拉 索菲亚'
);

// ===== 职业 / 街道 / 单位 =====
const JOBS_CN = splitWords(
  '会计 中学教师 小学教师 幼儿园教师 厨师 软件工程师 护士 医生 出租车司机 网约车司机 公交司机 建筑工人 车间工人 ' +
  '公务员 银行柜员 超市收银员 外卖骑手 快递员 大学生 高中生 咖啡馆店员 记者 药剂师 地铁司机 书店老板 面包师 ' +
  '牙医助理 景观设计师 图书管理员 保安 个体户 装修工 理发师 快递站长 房产中介 保险业务员 程序员 会计助理 ' +
  '小学退休教师 网管 保洁员 收银主管 仓库管理员 园艺工 兽医助理 裁缝 电工 水暖工 厨师长 餐饮店主'
);
const JOBS_JP = splitWords(
  '会社员 银行员 营业 教师 保育士 厨师 护士 出租车司机 建筑工人 便利店店员 配送员 居酒屋店员 设计师 ' +
  '药剂师 牙医助手 图书管理员 警备员 大学生 报社记者 面包师 铁道员 理发师 保洁员 仓库管理 农民 ' +
  '电工 厨师长 咖啡店员 销售 会计 事务员'
);
const JOBS_DE = splitWords(
  '会计 中学教师 厨师 软件工程师 护士 医生 出租车司机 建筑工人 大学生 咖啡馆店员 记者 药剂师 地铁司机 ' +
  '书店老板 快递员 面包师 牙医助理 景观设计师 舞台灯光师 图书管理员 公务员 机械师 电工 水暖工 ' +
  '司机 销售员 银行职员 理发师 保洁员 仓库管理员 木匠 屠夫 花匠'
);
const JOBS_EN = splitWords(
  '会计 高中教师 厨师 软件工程师 护士 医生 出租车司机 建筑工人 大学生 咖啡店店员 记者 药剂师 面包师 ' +
  '图书管理员 消防员 快递员 超市收银员 保险经纪 社工 水电工 健身教练 收银员 服务员 木匠 园丁 ' +
  '房地产经纪 银行职员 保安 司机 修理工 摄影师 售货员'
);
const JOBS_INTL = splitWords(
  '会计 教师 厨师 护士 医生 司机 建筑工人 大学生 店员 记者 药剂师 面包师 图书管理员 快递员 农民 ' +
  '技工 电工 理发师 保安 服务员 销售员 仓库管理员 裁缝 园丁'
);

const STREETS_CN = splitWords(
  '人民路 解放路 建设路 中山路 胜利街 长江路 黄河路 文化路 新华路 东风路 光明街 和平路 青年路 工农路 ' +
  '南京路 北京路 朝阳街 团结路 振兴路 金水路 二七路 经三路 纬五路 学院路 中州大道 农业路 桐柏路 ' +
  '嵩山路 航海路 未来路 商务外环 花园路 紫荆山路 城东路 京广路 陇海路 秦岭路 棉纺路 迎宾大道 环城路'
);
const STREETS_JP = splitWords(
  '中央通 本町通 樱木町 荣町 旭町 绿町 大手町 港町 新町 仲町 北本町 南本町 花园町 站前通 银座通 ' +
  '昭和町 平和町 若叶町 青叶町 朝日町 日吉町 富士见町 松风町 梅田町 川端町 上町 下町 东町 西町'
);
const STREETS_DE = splitWords(
  '亚历山大大街 卡尔·马克思大道 罗莎·卢森堡广场 奥拉宁街 明斯特街 海因里希·海涅街 托尔街 市政厅街 ' +
  '施潘道街 腓特烈大街 罗森街 林登街 雅各布街 罗克街 阿尔特·舍恩豪泽街 歌德街 席勒街 康德街 ' +
  '莱布尼茨街 洪堡街 火车站街 教堂街 磨坊街 城堡街 市场街 学校街 花园街 湖滨街 桥头街 北区街'
);
const STREETS_EN = splitWords(
  '主街 高街 橡树街 枫树街 教堂街 磨坊路 公园大道 华盛顿街 榆树街 湖滨路 栗树街 松树街 中央大道 ' +
  '河滨街 苹果街 栗子街 林荫道 维多利亚路 王后街 桥街 集市街 学校街 车站路 山景路 日落大道'
);
const STREETS_INTL = splitWords(
  '中央大街 市场街 教堂街 车站路 河滨路 公园路 老街 新街 海滨路 花园街 港口路 高地街'
);

const COMPANIES_CN = splitWords(
  '市第三中学 区人民医院 市第二人民医院 一家连锁超市 一家川菜馆 市公交公司 一家五金店 快递驿站 市图书馆 ' +
  '一家装修公司 一家社区诊所 一家汽修厂 市自来水公司 一家会计师事务所 一家软件公司 区派出所 市第一中学 ' +
  '一家火锅店 一家便利店 市供电公司 一家服装厂 一家建材市场 一家打印店 社区服务中心 一家健身房'
);
const COMPANIES_JP = splitWords(
  '市立医院 第三中学 株式会社山田商事 一家便利店 一家居酒屋 市立图书馆 一家面包坊 一家药局 市营公交 ' +
  '一家设计事务所 市役所 一家居酒屋连锁 株式会社田中建设 一家咖啡店 市立小学 一家拉面店'
);
const COMPANIES_DE = splitWords(
  '一家会计师事务所 市立第三中学 一家泰式餐厅 一家软件公司 夏里特医院 一家出租车行 一个地铁工地 ' +
  '洪堡大学 一家独立咖啡馆 一家地方报社 一家街角药店 柏林交通公司调度中心 一家面包房 一家建筑设计事务所 ' +
  '一家机械厂 市立图书馆 一家啤酒馆 一家书店'
);
const COMPANIES_EN = splitWords(
  '一家会计师事务所 市立医院 第三中学 一家连锁超市 一家咖啡店 一家面包房 市警察局 一家律师事务所 ' +
  '一家软件公司 一家健身房 一家药房 社区图书馆 一家五金店 市消防局 一家汽车修理厂 一家保险公司 ' +
  '一家银行分行 一家广告公司 高中'
);
const COMPANIES_INTL = splitWords(
  '一家当地公司 市立医院 一所中学 一家超市 一家咖啡馆 一家面包房 市政厅 一家药店 社区图书馆 ' +
  '一家修车厂 一家服装厂 一家贸易公司 一家餐馆'
);

// ---- 追加：德国 / 英语系 / 国际 的名字补足（上面几组偏少，这里再扩一轮） ----
DE_LAST.push(...splitWords(
  '瓦格纳 齐格勒 柯尼希 舒尔茨 鲍尔 里希特 克莱因 沃尔夫 诺伊曼 施瓦茨 齐默尔曼 布劳恩 克鲁格 ' +
  '哈特曼 兰格 维尔纳 克劳斯 莱曼 舒马赫 福格尔 弗里德里希 京特 贝格 温克勒 约瑟夫 施泰因 ' +
  '雅各布斯 普法夫 凯泽 施特劳斯 胡贝尔 施赖伯 布兰特 默勒 阿尔布雷希特 施罗德 施泰纳 施陶赫 ' +
  '恩格尔 塞德尔 库恩 霍尔特 洛伦茨 弗兰克 施特姆 奥托 西蒙 鲍曼 施密茨 泽勒 施图尔姆 海涅 ' +
  '歌德 席勒 康德 莱布尼茨 洪堡 格林 尼采 瓦尔特 施佩尔 施托尔茨'
));
DE_M2.push(...splitWords(
  '安东 克里斯托夫 迪特尔 埃贡 埃米尔 恩斯特 弗里茨 京特 格哈德 哈拉尔德 海因茨 赫尔穆特 ' +
  '霍斯特 约阿希姆 约翰 卡尔 库尔特 洛塔尔 曼弗雷德 马库斯 马丁 诺伯特 奥托 拉尔夫 赖纳 ' +
  '赖因哈德 鲁道夫 西格弗里德 乌尔里希 乌韦 维尔纳 沃尔夫冈 阿克塞尔 阿尔诺 蒂尔 弗洛里安 ' +
  '扬 伦纳特 马茨 尼尔斯 奥莱 斯文 蒂姆 托尔斯滕 芬恩 埃利亚斯 莱昂 米卡 尤利安 埃里克'
));
DE_F2.push(...splitWords(
  '阿德尔海德 安克 安妮特 贝娅特 比吉特 克里斯蒂娜 多丽丝 埃迪特 埃尔克 埃里卡 弗兰齐斯卡 ' +
  '加布里埃莱 格达 格特鲁德 吉塞拉 海克 赫尔加 英格丽德 卡琳 卡塔琳娜 克劳迪娅 科妮莉亚 ' +
  '玛加蕾特 玛丽昂 莫妮卡 娜丁 佩特拉 蕾娜特 罗莎 萨宾娜 西尔克 苏珊娜 塔尼娅 乌特 乌尔丽克 ' +
  '维拉 维尔玛 尤塔 弗兰卡 亨丽埃特 约翰娜 约瑟菲娜 莱奥妮 莉娜 玛雅 米拉 诺拉 宝拉 塞尔玛 特蕾莎 维奥拉'
));
EN_LAST.push(...splitWords(
  '埃文斯 墨菲 罗伯茨 刘易斯 沃克 怀特 汤普森 安德森 杰克逊 托马斯 罗宾逊 爱德华兹 格林 霍尔 ' +
  '伍德 贝克 莫里斯 库克 摩根 库珀 贝利 里德 凯利 霍华德 米切尔 卡特 菲利普斯 特纳 帕克 ' +
  '柯林斯 斯图尔特 莫里森 沃森 布鲁克 班尼特 格雷 詹姆斯 福斯特 格雷戈里 哈德森 凯恩 兰姆 ' +
  '梅森 尼尔森 奥尔森 佩恩 波特 奎因 里夫斯 肖 斯塔克 斯通 沃恩 韦伯 温特斯 扬'
));
EN_M2.push(...splitWords(
  '迈克尔 克里斯托弗 马修 安德鲁 约书亚 安东尼 马克 肯尼斯 凯文 布莱恩 杰森 埃里克 斯蒂芬 ' +
  '乔纳森 贾斯汀 亚伦 亚当 内森 伊恩 卢克 欧文 肖恩 科林 格雷厄姆 奈杰尔 西蒙 蒂莫西 拉尔夫 ' +
  '罗伊 阿尔弗雷德 伯纳德 克莱夫 邓肯 埃德加 弗雷德里克 戈登 哈罗德 霍华德 伊凡 基思 莱斯利 ' +
  '马尔科姆 诺曼 珀西 昆廷 罗杰 西德尼 特伦斯 维克多 沃尔特'
));
EN_F2.push(...splitWords(
  '苏珊 卡伦 南希 丽莎 贝蒂 玛格丽特 桑德拉 阿什利 金伯利 唐娜 米歇尔 卡罗尔 阿曼达 梅丽莎 ' +
  '黛博拉 斯蒂芬妮 丽贝卡 劳拉 莎伦 辛西娅 凯瑟琳 艾米 雪莉 安吉拉 布伦达 帕梅拉 妮可 ' +
  '萨曼莎 克里斯汀 黛安娜 朱莉 乔伊斯 凯莉 克里斯蒂娜 琼 伊芙琳 劳伦 朱迪思 弗朗西斯 玛莎 ' +
  '特蕾莎 格洛丽亚 埃塞尔 米尔德里德 罗斯 黛西 艾格尼丝'
));
IN_LAST.push(...splitWords(
  '罗德里格斯 费尔南德斯 洛佩斯 马丁内斯 加西亚 佩雷斯 冈萨雷斯 巴蒂斯塔 阿卜杜拉 艾哈迈德 ' +
  '侯赛因 阿里 卡里姆 阮 黎 潘 武 邓 范 拉莫斯 阿基诺 桑托斯 迪亚斯 莫雷拉 巴罗斯 ' +
  '诺盖拉 平托 卡多佐 特谢拉 莫赖斯 弗雷塔斯 阿尔维斯 阿劳霍 库尼亚 马查多'
));
IN_M2.push(...splitWords(
  '若昂 卡洛斯 路易斯 费尔南多 佩德罗 里卡多 米格尔 弗朗西斯科 彼得 马克思 阿里 哈桑 ' +
  '穆罕默德 奥马尔 阮文 陈明 阿米尔 约瑟夫 巴尔 内马尔 贝尔纳多 桑德罗 阿方索 布鲁诺 ' +
  '达尼洛 埃德森 法比奥 古斯塔沃 马塞洛 罗德里戈 蒂亚戈 维托尔 拉斐尔 卢卡斯'
));
IN_F2.push(...splitWords(
  '玛丽亚 安娜 费尔南达 伊娃 妮娜 莱拉 法蒂玛 阿伊莎 阮氏 陈美 桑德拉 卡门 露西亚 宝拉 ' +
  '米拉 索菲亚 阿德利娜 贝亚特丽斯 克拉拉 达妮埃拉 埃莱娜 加布里埃拉 若阿娜 卢西亚娜 ' +
  '玛尔塔 娜塔莉亚 保拉 拉斐拉 罗莎 特雷莎 瓦妮莎 泽莉亚'
));

const POOL_CN = {
  surnameFirst: true,
  last: CN_LAST,
  first: [...CN_M2, ...CN_F2, ...CN_M1, ...CN_F1, ...CN_A.flatMap((a) => CN_B.map((b) => a + b))],
  firstM: [...CN_M2, ...CN_M1],
  firstF: [...CN_F2, ...CN_F1],
  jobs: JOBS_CN, streets: STREETS_CN, companies: COMPANIES_CN,
};
const POOL_JP = {
  surnameFirst: true,
  last: JP_LAST,
  first: [...JP_M2, ...JP_F2, ...JP_A.flatMap((a) => JP_B.map((b) => a + b))],
  firstM: JP_M2,
  firstF: JP_F2,
  jobs: JOBS_JP, streets: STREETS_JP, companies: COMPANIES_JP,
};
const POOL_DE = {
  last: DE_LAST,
  first: [...DE_M2, ...DE_F2],
  firstM: DE_M2, firstF: DE_F2,
  jobs: JOBS_DE, streets: STREETS_DE, companies: COMPANIES_DE,
};
const POOL_EN = {
  last: EN_LAST,
  first: [...EN_M2, ...EN_F2],
  firstM: EN_M2, firstF: EN_F2,
  jobs: JOBS_EN, streets: STREETS_EN, companies: COMPANIES_EN,
};
const POOL_INTL = {
  last: IN_LAST,
  first: [...IN_M2, ...IN_F2],
  firstM: IN_M2, firstF: IN_F2,
  jobs: JOBS_INTL, streets: STREETS_INTL, companies: COMPANIES_INTL,
};

const POOLS = {
  中国: POOL_CN, 日本: POOL_JP, 德国: POOL_DE,
  英国: POOL_EN, 美国: POOL_EN, 澳大利亚: POOL_EN, 加拿大: POOL_EN,
};
let POOL = POOL_INTL;

/** 启动时按城市国家切换姓名池（main.js 在 boot 里调一次） */
export function setCountry(country) {
  POOL = POOLS[country] || POOL_INTL;
  return POOL;
}
export function namePool() { return POOL; }
/** 中日习惯「姓在前」；其它地区「名在前」 */
export function surnameFirst() { return !!POOL.surnameFirst; }

/** 当前国家的名 / 姓 / 职业 / 街道 / 单位池 */
export const firstNamePool = () => POOL.first;
export const lastNamePool = () => POOL.last;
export const jobsPool = () => POOL.jobs;
export const streetsPool = () => POOL.streets;
export const companiesPool = () => POOL.companies;

/** 稳定哈希：同一下标 + 盐永远得到同一个 [0,1) 值 */
export function h(i, salt) {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export const pick = (arr, i, salt) => arr[Math.floor(h(i, salt) * arr.length) % arr.length];

export function ageOf(i) { return 8 + Math.floor(h(i, 3) * 72); }
export function maleOf(i) { return h(i, 4) < 0.5; }

/** 职业：按年龄先分档，再按哈希抽 */
export function jobFor(i, age) {
  if (age < 20) return '学生';
  if (age > 65) return '退休';
  return pick(POOL.jobs, i, 5);
}

export function jobOf(i) { return jobFor(i, ageOf(i)); }

/** 这一行职业对应哪类地点（用来分配「工作地」） */
export const JOB_POI = {
  // 医疗
  护士: 'hospital', 药剂师: 'pharmacy', 牙医助理: 'hospital', 牙医助手: 'hospital',
  // 教育
  中学教师: 'school', 小学教师: 'school', 高中教师: 'school', 教师: 'school',
  大学生: 'school', 学生: 'school', 保育士: 'school',
  // 商业 / 服务
  咖啡馆店员: 'market', 咖啡店店员: 'market', 面包师: 'market', 书店老板: 'market',
  超市收银员: 'market', 店员: 'market', 便利店店员: 'market', 居酒屋店员: 'market',
  // 交通
  地铁司机: 'transit', 出租车司机: 'transit', 网约车司机: 'transit', 快递员: 'transit',
  外卖骑手: 'transit', 配送员: 'transit', 铁道员: 'transit', 司机: 'transit',
  // 政府 / 金融 / 媒体
  会计: 'gov', 公务员: 'gov', 记者: 'gov', 报社记者: 'gov', 银行柜员: 'gov',
  银行员: 'gov', 保险经纪: 'gov',
};

/** 家有没有枪（M5 用，先定下来免得以后改公式） */
export function hasGunAtHome(i) { return h(i, 21) < 0.12; }

/** 性格：0 = 胆小，1 = 莽 */
export function braveOf(i) { return h(i, 22); }

// ---------------- 四个性格属性（0–100） ----------------
// 政府信任 / 家庭责任 / 意志 / 勇猛
// 不是纯随机：职业、年龄会先定一个基准，再加个人噪声，
// 保证"人设"和"身份"对得上（警察不会普遍不信任政府）。
export const ATTR_ROLE = {
  civilian: { trust: 50, family: 60, will: 50, courage: 45 },
  police:   { trust: 65, family: 60, will: 70, courage: 60 },
  soldier:  { trust: 68, family: 55, will: 75, courage: 70 },
  vip:      { trust: 80, family: 45, will: 60, courage: 35 },
};

export function attrFor(i, role = 'civilian') {
  const base = ATTR_ROLE[role] || ATTR_ROLE.civilian;
  const age = ageOf(i);
  const noise = (salt) => (h(i, salt) - 0.5) * 24;   // ±12
  let trust = base.trust + noise(61);
  let family = base.family + noise(62);
  let will = base.will + noise(63);
  let courage = base.courage + noise(64);
  if (age > 65) { trust += 12; courage -= 12; }
  else if (age < 25) { trust -= 8; courage += 8; will += 4; }
  if (age >= 30 && age <= 50) family += 8;            // 有孩子的年纪
  return {
    trust: Math.max(5, Math.min(95, Math.round(trust))),
    family: Math.max(5, Math.min(95, Math.round(family))),
    will: Math.max(5, Math.min(95, Math.round(will))),
    courage: Math.max(5, Math.min(95, Math.round(courage))),
  };
}
