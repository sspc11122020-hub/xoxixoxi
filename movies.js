import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// إعدادات المسارات
const MOVIES_DIR = path.join(__dirname, "movies");
const HOME_FILE = path.join(MOVIES_DIR, "Home.json");

// إنشاء مجلد movies إذا لم يكن موجوداً
if (!fs.existsSync(MOVIES_DIR)) {
    fs.mkdirSync(MOVIES_DIR, { recursive: true });
}

const BASE_URL = "https://topcinemaa.com";

// ==================== دوال المساعدة ====================
async function fetchPage(url) {
    try {
        console.log(`🌐 جاري جلب: ${url.substring(0, 60)}...`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
            'Referer': BASE_URL,
        };
        
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            console.log(`❌ فشل الجلب: ${response.status}`);
            return null;
        }
        
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
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        const lastPart = pathParts[pathParts.length - 1];
        const numMatch = lastPart.match(/(\d+)$/);
        return numMatch ? numMatch[1] : `temp_${Date.now()}`;
    } catch {
        return `temp_${Date.now()}`;
    }
}

// قنص روابط m3u8 من المصدر المفتوح
function findM3u8InSource(htmlContent) {
    if (!htmlContent) return null;
    
    const m3u8Regex = /(https?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_\+.~#?&//=]*\.m3u8[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/i;
    let match = htmlContent.match(m3u8Regex);
    
    if (match) {
        return match[1].replace(/\\/g, ''); 
    }

    const alternativeRegex = /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i;
    match = htmlContent.match(alternativeRegex);
    if (match) {
        return match[1].replace(/\\/g, '');
    }

    return null;
}

// ==================== استخراج سيرفرات المشاهدة بالنقرات الفعلية (Puppeteer) ====================
async function extractWatchServers(watchUrl) {
    let browser;
    try {
        console.log(`   👁️ جاري فتح المتصفح لمحاكاة النقر على السيرفرات...`);
        
        // تشغيل متصفح خفي وسريع
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // منع تحميل الصور والخطوط لتسريع التصفح
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // الذهاب لصفحة المشاهدة
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // الانتظار حتى تظهر قائمة السيرفرات في الصفحة
        await page.waitForSelector('.watch--servers--list ul li.server--item', { timeout: 10000 });
        
        // استخراج بيانات الأزرار (الاسم والترتيب) من المتصفح
        const serversList = await page.evaluate(() => {
            const items = document.querySelectorAll('.watch--servers--list ul li.server--item');
            return Array.from(items).map((item, index) => ({
                index: index,
                name: item.querySelector('span')?.textContent?.trim() || `سيرفر ${index + 1}`
            }));
        });
        
        console.log(`   🔍 تم كشف ${serversList.length} أزرار سيرفرات. جاري النقر واستخلاص الروابط...`);
        const servers = [];
        
        // الدوران على كل زر، النقر عليه، وقراءة الـ iframe الجديد
        for (const server of serversList) {
            console.log(`      🖱️ النقر على: [${server.name}]`);
            
            // تحديد العنصر عبر ترتيبه والنقر عليه
            const serverSelector = `.watch--servers--list ul li.server--item`;
            await page.evaluate((idx, selector) => {
                const elements = document.querySelectorAll(selector);
                if (elements[idx]) {
                    elements[idx].click();
                }
            }, server.index, serverSelector);
            
            // الانتظار ثانية ونصف لكي تتحدث الصفحة ويتحمل الـ iframe الجديد
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // استخراج رابط الـ iframe الحالي بعد النقر
            const iframeSrc = await page.evaluate(() => {
                const iframe = document.querySelector('.player--iframe iframe') || document.querySelector('iframe[src*="embed"], iframe[src*="video"], iframe[src*="player"]');
                return iframe ? iframe.src : null;
            });
            
            if (iframeSrc) {
                let m3u8Url = iframeSrc.includes('.m3u8') ? iframeSrc : null;
                
                // إذا لم يكن الرابط m3u8 صريحاً، نقوم بفحص كود الـ iframe في الخلفية لقنصه
                if (!m3u8Url) {
                    const serverHtml = await fetchPage(iframeSrc);
                    m3u8Url = findM3u8InSource(serverHtml);
                }
                
                servers.push({
                    name: server.name,
                    url: iframeSrc,
                    quality: "متعدد الجودات",
                    type: "puppeteer_click",
                    m3u8Url: m3u8Url
                });
                console.log(`         ✅ تم بنجاح: ${iframeSrc.substring(0, 70)}...`);
            } else {
                console.log(`         ⚠️ لم يتم العثور على iframe لهذا السيرفر.`);
            }
        }
        
        return servers;
        
    } catch (error) {
        console.log(`   ⚠️ خطأ أثناء النقر واستخراج السيرفرات: ${error.message}`);
        return [];
    } finally {
        if (browser) {
            await browser.close();
            console.log(`   🔒 تم إغلاق المتصفح المدمج.`);
        }
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
        
        // 1. سيرفرات proServer
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
        
        // 2. سيرفرات الجودات DownloadBlock
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
        console.log(`   ⚠️ خطأ في سيرفرات التحميل: ${error.message}`);
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
        const imdbElement = doc.querySelector(".imdbR span, .imdbRating span");
        const imdbRating = imdbElement ? cleanText(imdbElement.textContent) : null;
        
        const storyElement = doc.querySelector(".story p, .entry-content p");
        const story = cleanText(storyElement?.textContent) || "غير متوفر";
        
        const details = {};
        const detailItems = doc.querySelectorAll("ul.RightTaxContent li, .post-details li, .movie-details li");
        
        detailItems.forEach(item => {
            const labelElement = item.querySelector("span, strong:first-child");
            if (labelElement) {
                let label = cleanText(labelElement.textContent).replace(":", "").trim();
                let value = cleanText(item.textContent.replace(labelElement.textContent, ""));
                const links = item.querySelectorAll("a");
                const linkTexts = links.length > 0 ? Array.from(links).map(a => cleanText(a.textContent)) : [];
                
                if (label.includes('قسم') || label.includes('التصنيف')) details["قسم الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('نوع')) details["نوع الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('جودة')) details["جودة الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('توقيت') || label.includes('مدة')) details["توقيت الفيلم"] = value;
                else if (label.includes('صدور') || label.includes('تاريخ')) details["موعد الصدور"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('دولة')) details["دولة الفيلم"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('مخرج')) details["المخرجين"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('بطولة')) details["بطولة"] = linkTexts.length > 0 ? linkTexts : value.split(',');
            }
        });

        const watchButton = doc.querySelector('a.watch, a[href*="/watch/"], .watch-btn a');
        const downloadButton = doc.querySelector('a.download, a[href*="/download/"], .download-btn a');
        
        let watchServers = [];
        if (watchButton && watchButton.href) {
            watchServers = await extractWatchServers(watchButton.href);
        } else {
            watchServers = await extractWatchServers(movie.url);
        }
        
        let downloadServers = [];
        if (downloadButton && downloadButton.href) {
            downloadServers = await extractDownloadServers(downloadButton.href);
        }
        
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

// ==================== الدالة الأساسية للتشغيل ====================
async function startScraping() {
    console.log("🚀 بدء استخراج الصفحة الأولى فقط من قسم الأفلام...");
    const url = `${BASE_URL}/movies/`;
    
    const html = await fetchPage(url);
    if (!html) {
        console.log("❌ فشل جلب الصفحة الرئيسية للموقع.");
        return;
    }
    
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const initialMovies = [];
    
    const movieElements = doc.querySelectorAll('.Small--Box a.recent--block');
    console.log(`✅ تم العثور على ${movieElements.length} فيلم في الصفحة الأولى.`);
    
    movieElements.forEach((element, i) => {
        let movieUrl = element.href;
        if (movieUrl) {
            if (movieUrl.startsWith('/')) movieUrl = BASE_URL + movieUrl;
            
            const titleElement = element.querySelector('h3.title') || element.querySelector('.title');
            const title = cleanText(titleElement?.textContent || `فيلم ${i + 1}`);
            
            initialMovies.push({
                title: title,
                url: movieUrl
            });
        }
    });
    
    const finalMoviesList = [];
    
    for (let i = 0; i < initialMovies.length; i++) {
        const movieDetails = await fetchMovieDetails(initialMovies[i], i + 1, initialMovies.length);
        if (movieDetails) {
            finalMoviesList.push(movieDetails);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const fileContent = {
        fileName: "Home.json",
        description: "أفلام الصفحة الأولى مع روابط البث المباشر m3u8 المستخرجة بالكامل",
        totalMovies: finalMoviesList.length,
        lastUpdated: new Date().toISOString(),
        movies: finalMoviesList
    };
    
    fs.writeFileSync(HOME_FILE, JSON.stringify(fileContent, null, 2));
    console.log(`\n🏠 اكتملت العملية بنجاح! تم حفظ الصفحة الأولى في: ${HOME_FILE}`);
}

// تشغيل السكريبت
startScraping();
