import axios from 'axios';
import fs from 'fs';

/**
 * دالة لاستخراج رابط السيرفر (iframe src) من صفحة المباراة الرئيسية
 */
async function getServerIframeUrl(pageUrl) {
    if (!pageUrl) return "";
    
    try {
        const { data } = await axios.get(pageUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://liva7hd.info/'
            },
            timeout: 10000 
        });

        // جلب جميع وسوم iframe في الصفحة
        const iframes = data.match(/<iframe[^>]+>/gi) || [];
        
        // البحث عن الـ iframe الخاص بالمشغل الرئيسي
        for (let iframe of iframes) {
            if (iframe.includes('id="main-player"') || iframe.includes("id='main-player'")) {
                const srcMatch = iframe.match(/src=["']([^"']+)["']/i);
                if (srcMatch) return srcMatch[1];
            }
        }

        // خطة بديلة: البحث عن أي iframe يحتوي رابطه على "/tv/"
        for (let iframe of iframes) {
            const srcMatch = iframe.match(/src=["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1].includes('/tv/')) {
                return srcMatch[1];
            }
        }

        return "";
    } catch (e) {
        console.log(`⚠️ فشل في جلب رابط السيرفر من: ${pageUrl}`);
        return "";
    }
}

/**
 * دالة لاستخراج الرابط المباشر m3u8 من رابط السيرفر المستخرج
 */
async function getDirectStream(iframeUrl) {
    if (!iframeUrl) return "";
    
    const fullIframeUrl = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;

    try {
        const { data } = await axios.get(fullIframeUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://liva7hd.info/',
                'Accept': '*/*'
            },
            timeout: 10000 
        });

        // 1. البحث عن روابط m3u8 الصريحة
        const m3u8Regex = /https?[:\/\w\.-]+\.m3u8[^\s"']*/gi;
        let matches = data.match(m3u8Regex);

        if (matches && matches.length > 0) {
            return matches[0].replace(/\\/g, ''); 
        }

        // 2. البحث عن الروابط داخل سمة "source" في المشغل
        const sourceRegex = /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i;
        const sourceMatch = data.match(sourceRegex);
        if (sourceMatch) return sourceMatch[1];

        // 3. البحث عن روابط Base64 (إذا كان المشغل يشفر الرابط)
        const base64Regex = /["']([A-Za-z0-9+/]{50,})={0,2}["']/g;
        let b64Matches;
        while ((b64Matches = base64Regex.exec(data)) !== null) {
            try {
                let decoded = Buffer.from(b64Matches[1], 'base64').toString('utf-8');
                if (decoded.includes('.m3u8')) {
                    return decoded.match(/https?[:\/\w\.-]+\.m3u8[^\s"']*/i)[0];
                }
            } catch (e) {}
        }

        return "";
    } catch (e) {
        return "";
    }
}

/**
 * السكريبت الرئيسي للتعامل مع الـ API
 */
async function scrapeMatches() {
    try {
        console.log("🚀 جاري جلب المباريات من الـ API...");
        
        const apiUrl = `https://liva7hd.info/wp-content/themes/jannah-1/MatchesPanel/api/matches.php?v=${Date.now()}`;
        
        const { data } = await axios.get(apiUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' 
            }
        });

        const matchesData = data.matches || [];
        const formattedMatches = [];

        for (let i = 0; i < matchesData.length; i++) {
            const matchInfo = matchesData[i];
            
            const team1Name = matchInfo.team1?.name || "";
            const team2Name = matchInfo.team2?.name || "";

            console.log(`🔍 جاري معالجة: ${team1Name} vs ${team2Name}`);

            // 1. رابط الصفحة الرئيسية للمباراة
            const matchPageLink = matchInfo.meta?.link || "";
            
            // 2. استخراج رابط السيرفر (iframe)
            let streamUrl = "";
            if (matchPageLink) {
                streamUrl = await getServerIframeUrl(matchPageLink);
            }

            // 3. استخراج رابط البث (m3u8) من السيرفر
            let directStream = "";
            if (streamUrl) {
                console.log(`🌐 تم العثور على رابط السيرفر، جاري فك التشفير...`);
                directStream = await getDirectStream(streamUrl);
            }

            if (directStream) {
                console.log(`✅ تم العثور على الرابط المباشر (m3u8)!`);
            } else {
                console.log(`❌ لم يتم العثور على رابط m3u8`);
            }

            let matchStatus = matchInfo.meta?.status || "";
            if (matchStatus && matchStatus.toLowerCase() === "live") {
                matchStatus = "جارية الآن";
            }

            // هيكل الـ JSON المطلوب بدون تغيير
            const match = {
                id: i + 1,
                team1: team1Name,
                team1Logo: matchInfo.team1?.logo || "",
                team2: team2Name,
                team2Logo: matchInfo.team2?.logo || "",
                time: "", 
                status: matchStatus,
                channel: matchInfo.meta?.channel || matchInfo.meta?.commentator || "",
                league: matchInfo.meta?.champ || "",
                streamUrl: streamUrl, // تم وضع رابط الـ iframe هنا
                stream: directStream  // تم وضع رابط الـ m3u8 هنا
            };

            formattedMatches.push(match);
        }

        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
        console.log("---");
        console.log(`✅ انتهى العمل. تم حفظ ${formattedMatches.length} مباراة في matches.json بنجاح.`);

    } catch (error) {
        console.error('❌ خطأ في السكربت الرئيسي:', error.message);
    }
}

scrapeMatches();
