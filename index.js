import puppeteer from 'puppeteer';
import fs from 'fs';

const BASE_URL = 'https://www.korax90.net/matches-today';

// دالة التقاط الروابط من الشبكة
async function getDirectStream(browser, iframeUrl) {
    if (!iframeUrl) return "";
    const fullIframeUrl = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;

    return new Promise(async (resolve) => {
        let found = false;
        let page;
        try {
            page = await browser.newPage();
            // محاكاة متصفح حقيقي بالكامل
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
            
            page.on('request', (request) => {
                if (request.url().includes('.m3u8') && !found) {
                    found = true;
                    resolve(request.url());
                    page.close().catch(() => {});
                }
            });

            await page.goto(fullIframeUrl, { waitUntil: 'networkidle2', timeout: 25000 });
            
            // محاكاة نقرة للبدء (ضرورية للمشغلات)
            await page.mouse.click(500, 300).catch(() => {});
            
            setTimeout(() => {
                if (!found) { page.close().catch(() => {}); resolve(""); }
            }, 12000);
        } catch (e) {
            if (page) await page.close().catch(() => {});
            resolve("");
        }
    });
}

async function scrapeMatches() {
    let browser;
    try {
        console.log("🚀 جاري تهيئة المتصفح...");
        browser = await puppeteer.launch({ 
            headless: "new", 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
        
        console.log("🔍 جاري فتح الموقع...");
        await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });

        const matches = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.match-item').forEach(el => {
                const btn = el.querySelector('button.match-row');
                const teams = el.querySelectorAll('.team');
                items.push({
                    team1: teams[0]?.querySelector('.team-name')?.innerText.trim() || "",
                    team1Logo: teams[0]?.querySelector('img')?.src || "",
                    team2: teams[1]?.querySelector('.team-name')?.innerText.trim() || "",
                    team2Logo: teams[1]?.querySelector('img')?.src || "",
                    time: el.querySelector('.score-time')?.innerText.trim() || "",
                    status: el.querySelector('.status-badge')?.innerText.trim() || "",
                    league: el.querySelector('.league')?.innerText.trim() || "",
                    streamUrl: btn?.getAttribute('data-frame') || "",
                    channel: "غير متوفر",
                    LastTime: new Date().toLocaleString('ar-EG'),
                    stream: ""
                });
            });
            return items;
        });

        for (let match of matches) {
            if (match.streamUrl) {
                console.log(`⏳ جاري استخراج بث: ${match.team1}`);
                match.stream = await getDirectStream(browser, match.streamUrl);
            }
        }

        fs.writeFileSync('match1.json', JSON.stringify(matches, null, 2), 'utf8');
        console.log("✅ انتهى العمل. تم حفظ البيانات في match1.json");

    } catch (error) {
        console.error('❌ خطأ فادح:', error.message);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeMatches();
