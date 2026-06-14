import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";
import { chromium } from "playwright"; // 🔥 استيراد المتصفح الذكي

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MOVIES_DIR = path.join(__dirname, "movies");
const HOME_FILE = path.join(MOVIES_DIR, "Home.json");

if (!fs.existsSync(MOVIES_DIR)) {
    fs.mkdirSync(MOVIES_DIR, { recursive: true });
}

const BASE_URL = "https://topcinemaa.com";

// دالة الجلب العادية للصفحات النصية
async function fetchPage(url) {
    try {
        console.log(`🌐 جاري جلب: ${url.substring(0, 60)}...`);
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': BASE_URL,
        };
        const response = await fetch(url, { headers });
        if (!response.ok) return null;
        return await response.text();
    } catch (error) {
        console.log(`❌ خطأ في الجلب: ${error.message}`);
        return null;
    }
}

function cleanText(text) {
    return text ? text.replace(/\s+/g, " ").trim() : "";
}

function extractMovieId(url) {
    try {
        const match = url.match(/[?&]p=(\d+)/);
        if (match && match[1]) return match[1];
        const urlObj = new URL(url);
        return urlObj.pathname.split('/').filter(p => p).pop().match(/(\d+)$/)?.[1] || `temp_${Date.now()}`;
    } catch {
        return `temp_${Date.now()}`;
    }
}

// ==================== 🔥 قنص روابط الشبكة الذكي (Network Sniffer) ====================
async function sniffDirectStream(iframeUrl) {
    if (!iframeUrl) return null;
    
    let directUrl = null;
    // تشغيل متصفح مخفي وسريع
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // 🎯 التنصت على حركات الشبكة (Network Requests)
        page.on('request', request => {
            const url = request.url();
            // إذا لقطنا طلب لملف بث مباشر مدمج فيه الـ Token أو الـ CDN
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                if (!url.includes('vtt') && !url.includes('subtitle')) { // تجنب ملفات الترجمة
                    directUrl = url;
                }
            }
        });

        console.log(`   📡 جاري فحص الشبكة للمشغل: ${iframeUrl.substring(0, 50)}...`);
        // الذهاب لصفحة المشغل والانتظار حتى يستقر الاتصال وتظهر الروابط (ننتظر 5 ثوانٍ كحد أقصى)
        await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(4000); // مهلة كافية لكي يطلب المشغل ملف الـ m3u8

    } catch (e) {
        console.log(`   ⚠️ تنبيه أثناء فحص شبكة المشغل: ${e.message}`);
    } finally {
        await browser.close(); // إغلاق المتصفح دائماً لتوفير الرام
    }

    return directUrl;
}

// ==================== استخراج سيرفرات المشاهدة وروابط m3u8 ====================
async function extractWatchServers(watchUrl) {
    try {
        console.log(`   👁️ جاري استخراج سيرفرات المشاهدة...`);
        const html = await fetchPage(watchUrl);
        if (!html) return [];
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const servers = [];
        
        // جلب الـ Iframes الخاصة بالمشغلات
        const iframes = doc.querySelectorAll('iframe[src*="embed"], iframe[src*="video"], iframe[src*="player"], iframe[src*="vtt"], iframe[src*="ramp"], iframe[src*="stream"]');
        
        for (let i = 0; i < iframes.length; i++) {
            let src = iframes[i].src;
            if (src) {
                if (src.startsWith('//')) src = 'https:' + src;
                
                // 🔥 استدعاء القناص ليلقط الرابط المباشر من الـ Network الحية!
                const directLiveUrl = await sniffDirectStream(src);

                servers.push({
                    name: `سيرفر مشاهدة ${i + 1}`,
                    url: src,
                    quality: "متعدد الجودات",
                    type: "iframe",
                    m3u8Url: directLiveUrl // الرابط المباشر المقنوص من الشبكة
                });
                
                if (directLiveUrl) {
                    console.log(`   🎯 [صيد ثمين] تم قنص الرابط المباشر من الشبكة بنجاح!`);
                }
            }
        }
        
        return servers;
        
    } catch (error) {
        console.log(`   ⚠️ خطأ في سيرفرات المشاهدة: ${error.message}`);
        return [];
    }
}

// ==================== استخراج سيرفرات التحميل ====================
async function extractDownloadServers(downloadUrl) {
    try {
        console.log(`   ⬇️ جاري استخراج سيرفرات التحميل...`);
        const html = await fetchPage(downloadUrl);
        if (!html) return [];
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const servers = [];
        
        const proServers = doc.querySelectorAll('.proServer a.downloadsLink');
        proServers.forEach(server => {
            const nameElement = server.querySelector('.text p');
            const qualityElement = server.querySelector('.text span');
            servers.push({
                name: cleanText(nameElement?.textContent) || "VidTube",
                url: server.href,
                quality: cleanText(qualityElement?.textContent) || "متعدد الجودات",
                type: "pro_server"
            });
        });
        
        const downloadBlocks = doc.querySelectorAll('.DownloadBlock');
        downloadBlocks.forEach(block => {
            const qualityElement = block.querySelector('.download-title span');
            const quality = qualityElement ? cleanText(qualityElement.textContent) : "1080p";
            
            const serverLinks = block.querySelectorAll('ul.download-items a.downloadsLink');
            serverLinks.forEach(link => {
                const nameElement = link.querySelector('.text p');
                servers.push({
                    name: cleanText(nameElement?.textContent) || quality,
                    url: link.href,
                    quality: quality,
                    type: "download_server"
                });
            });
        });
        
        return servers.filter((server, index, self) => index === self.findIndex((s) => s.url === server.url));
        
    } catch (error) {
        return [];
    }
}

// ==================== استخراج التفاصيل الكاملة للفيلم ====================
async function fetchMovieDetails(movie, position, total) {
    console.log(`\n🎬 [${position}/${total}] جاري استخراج تفاصيل: ${movie.title}...`);
    try {
        const html = await fetchPage(movie.url);
        if (!html) return null;
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        
        const shortLinkInput = doc.querySelector('input#shortlink');
        let shortLink = shortLinkInput ? shortLinkInput.value : movie.url;
        const movieId = extractMovieId(shortLink);
        
        const titleElement = doc.querySelector("h1.post-title a") || doc.querySelector(".post-title");
        const title = cleanText(titleElement?.textContent || movie.title);
        let image = doc.querySelector(".image img")?.src || doc.querySelector("img[src*='MV5B']")?.src;
        const imdbRating = cleanText(doc.querySelector(".imdbR span, .imdbRating span")?.textContent) || null;
        const story = cleanText(doc.querySelector(".story p, .entry-content p")?.textContent) || "غير متوفر";
        
        const details = {};
        doc.querySelectorAll("ul.RightTaxContent li, .post-details li").forEach(item => {
            const labelElement = item.querySelector("span, strong:first-child");
            if (labelElement) {
                let label = cleanText(labelElement.textContent).replace(":", "").trim();
                let value = cleanText(item.textContent.replace(labelElement.textContent, ""));
                const links = item.querySelectorAll("a");
                const linkTexts = links.length > 0 ? Array.from(links).map(a => cleanText(a.textContent)) : [];
                
                if (label.includes('قسم') || label.includes('التصنيف')) details["قسم الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('نوع')) details["نوع الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('جودة')) details["جودة الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('موعد') || label.includes('تاريخ')) details["موعد الصدور"] = linkTexts.length > 0 ? linkTexts : [value];
            }
        });

        const watchButton = doc.querySelector('a.watch, a[href*="/watch/"], .watch-btn a');
        const downloadButton = doc.querySelector('a.download, a[href*="/download/"], .download-btn a');
        
        let watchServers = await extractWatchServers(watchButton ? watchButton.href : movie.url);
        let downloadServers = downloadButton ? await extractDownloadServers(downloadButton.href) : [];
        
        return {
            id: movieId,
            title: title,
            url: movie.url,
            shortLink: shortLink,
            image: image || null,
            imdbRating: imdbRating,
            story: story,
            details: details,
            watchServers: watchServers,
            downloadServers: downloadServers,
            scrapedAt: new Date().toISOString()
        };
    } catch (error) {
        console.log(` ❌ خطأ في تفاصيل الفيلم: ${error.message}`);
        return null;
    }
}

// ==================== الدالة الأساسية ====================
async function startScraping() {
    console.log("🚀 بدء استخراج الأفلام مع فحص الـ Network...");
    const url = `${BASE_URL}/movies/`;
    
    const html = await fetchPage(url);
    if (!html) return;
    
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const initialMovies = [];
    
    doc.querySelectorAll('.Small--Box a.recent--block').forEach((element, i) => {
        let movieUrl = element.href;
        if (movieUrl) {
            if (movieUrl.startsWith('/')) movieUrl = BASE_URL + movieUrl;
            initialMovies.push({
                title: cleanText(element.querySelector('h3.title')?.textContent || `فيلم ${i + 1}`),
                url: movieUrl
            });
        }
    });
    
    console.log(`✅ تم العثور على ${initialMovies.length} فيلم.`);
    const finalMoviesList = [];
    
    // فحص أول فيلمين كمثال للتأكد من السرعة واللقط الصحيح للشبكة
    const limit = Math.min(initialMovies.length, 2); 
    for (let i = 0; i < limit; i++) {
        const movieDetails = await fetchMovieDetails(initialMovies[i], i + 1, limit);
        if (movieDetails) finalMoviesList.push(movieDetails);
    }
    
    const fileContent = {
        fileName: "Home.json",
        totalMovies: finalMoviesList.length,
        lastUpdated: new Date().toISOString(),
        movies: finalMoviesList
    };
    
    fs.writeFileSync(HOME_FILE, JSON.stringify(fileContent, null, 2));
    console.log(`\n🏠 انتهت العملية بنجاح! تم التخزين في: ${HOME_FILE}`);
}

startScraping();
