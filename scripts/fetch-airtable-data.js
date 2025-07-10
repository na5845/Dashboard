// scripts/fetch-airtable-data.js
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

// Airtable configuration from environment variables
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_URL = 'https://api.airtable.com/v0';

// Helper function to fetch all records (handling pagination)
async function fetchAllRecords() {
    let allRecords = [];
    let offset = '';
    
    console.log('🔄 Starting to fetch records from Airtable...');
    
    do {
        const url = `${AIRTABLE_BASE_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }
            
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
            
            console.log(`📦 Fetched ${data.records.length} records (Total: ${allRecords.length})`);
            
        } catch (error) {
            console.error('❌ Error fetching data:', error.message);
            throw error;
        }
    } while (offset);
    
    return allRecords;
}

// Helper function to get Israel time - FIXED VERSION
function getIsraelTime(date = new Date()) {
    // Create a date object with the correct timezone offset
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const israelOffset = 3; // Israel is UTC+3 (or UTC+2 in winter, but let's use 3 for now)
    const israelTime = new Date(utcTime + (3600000 * israelOffset));
    return israelTime;
}

// Alternative more robust method using Intl.DateTimeFormat
function getIsraelTimeV2(date = new Date()) {
    // Format the date in Israel timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const dateObj = {};
    
    parts.forEach(part => {
        dateObj[part.type] = part.value;
    });
    
    return new Date(
        parseInt(dateObj.year),
        parseInt(dateObj.month) - 1,
        parseInt(dateObj.day),
        parseInt(dateObj.hour),
        parseInt(dateObj.minute),
        parseInt(dateObj.second)
    );
}

// Helper function to get date without time (at midnight)
function getDateOnly(date) {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Process the raw data
function processData(records) {
    console.log('⚙️ Processing data...');
    
    // Get current time - use the fixed function
    const serverNow = new Date();
    const now = getIsraelTimeV2(serverNow);
    
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentDay = now.getDate();
    
    console.log('🕐 Server time:', serverNow.toString());
    console.log('🕐 Israel time:', now.toString(), `(Should be UTC+3)`);
    console.log(`📅 Processing for: ${currentDay}/${currentMonth + 1}/${currentYear}`);
    
    // Calculate last month correctly
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    
    // Create date ranges - using local Israel dates
    const currentMonthStart = new Date(currentYear, currentMonth, 1);
    const currentMonthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
    const lastMonthStart = new Date(lastMonthYear, lastMonth, 1);
    const lastMonthEnd = new Date(lastMonthYear, lastMonth + 1, 0, 23, 59, 59, 999);
    
    console.log('📅 Current month range:', currentMonthStart.toLocaleDateString('he-IL'), 'to', currentMonthEnd.toLocaleDateString('he-IL'));
    console.log('📅 Last month range:', lastMonthStart.toLocaleDateString('he-IL'), 'to', lastMonthEnd.toLocaleDateString('he-IL'));
    
    const stats = {
        lastUpdate: new Date().toISOString(),
        lastUpdateLocal: new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }),
        currentMonth: { 
            total: 0, 
            daily: {}, 
            categories: {}, 
            organizations: {},
            categoryOrg: {} 
        },
        lastMonth: { 
            total: 0, 
            daily: {}, 
            categories: {}, 
            organizations: {},
            categoryOrg: {} 
        },
        monthlyData: {},
        yearlyData: {
            '2022': 413501,
            '2023': 527445,
            '2024': 913946,
            '2025': 0
        }
    };
    
    // Find field names dynamically
    const possibleAmountFields = ['סכום עסקה', 'סכום', 'Amount', 'amount'];
    const possibleDateFields = ['תאריך ושעת ביצוע העסקה', 'תאריך', 'Date', 'date', 'Created'];
    const possibleCategoryFields = ['קטגוריה', 'Category', 'category', 'סוג'];
    const possibleOrgFields = ['עמותה', 'Organization', 'organization', 'ארגון'];
    
    let amountField = null;
    let dateField = null;
    let categoryField = null;
    let orgField = null;
    
    // Sample first few records to find field names
    for (const record of records.slice(0, 5)) {
        const fields = Object.keys(record.fields);
        
        if (!amountField) {
            amountField = possibleAmountFields.find(field => fields.includes(field));
        }
        if (!dateField) {
            dateField = possibleDateFields.find(field => fields.includes(field));
        }
        if (!categoryField) {
            categoryField = possibleCategoryFields.find(field => fields.includes(field));
        }
        if (!orgField) {
            orgField = possibleOrgFields.find(field => fields.includes(field));
        }
        
        if (amountField && dateField) break;
    }
    
    if (!amountField || !dateField) {
        throw new Error(`Missing required fields: ${!amountField ? 'Amount' : ''} ${!dateField ? 'Date' : ''}`);
    }
    
    console.log(`📋 Found fields: Amount="${amountField}", Date="${dateField}", Category="${categoryField}", Org="${orgField}"`);
    
    // Process valid records
    const validRecords = records.filter(record => {
        const amount = record.fields[amountField];
        const date = record.fields[dateField];
        return amount && date && parseFloat(amount) > 0;
    });
    
    console.log(`✅ Processing ${validRecords.length} valid records`);
    console.log('📊 Sample records for debugging:');
    
    // Show first 5 records for debugging
    validRecords.slice(0, 5).forEach((record, index) => {
        console.log(`  Record ${index + 1}:`, {
            date: record.fields[dateField],
            amount: record.fields[amountField],
            category: record.fields[categoryField],
            org: record.fields[orgField]
        });
    });
    
    let recordsInCurrentMonth = 0;
    let recordsInLastMonth = 0;
    let recordsInOtherPeriods = 0;
    
    validRecords.forEach((record, recordIndex) => {
        const fields = record.fields;
        const amount = parseFloat(fields[amountField]);
        const dateStr = fields[dateField];
        
        let date;
        try {
            // Parse the date - it comes in ISO format with Z (UTC)
            date = new Date(dateStr);
            if (isNaN(date.getTime())) {
                console.warn(`❌ Invalid date in record ${recordIndex + 1}:`, dateStr);
                return;
            }
            
            // Convert to Israel time for display and comparison
            // Note: For comparison, we'll use the UTC date but compare at day level
        } catch (e) {
            console.warn(`❌ Error parsing date in record ${recordIndex + 1}:`, dateStr, e);
            return;
        }
        
        const category = fields[categoryField] || 'לא מוגדר';
        const organization = fields[orgField] || 'אחר';
        
        // For comparison, use the date as-is but compare at day level
        // Get the year, month, day in Israel timezone
        const israelDate = getIsraelTimeV2(date);
        const recordYear = israelDate.getFullYear();
        const recordMonth = israelDate.getMonth();
        const recordDay = israelDate.getDate();
        
        // Log first few records in detail
        if (recordIndex < 10) {
            console.log(`📝 Record ${recordIndex + 1}: ${israelDate.toLocaleDateString('he-IL')} ${israelDate.toLocaleTimeString('he-IL')} - ₪${amount} - ${category} - ${organization}`);
        }
        
        // Current month check
        if (recordYear === currentYear && recordMonth === currentMonth) {
            recordsInCurrentMonth++;
            addToMonthStats(stats.currentMonth, amount, israelDate, category, organization);
            
            if (recordIndex < 10) {
                console.log(`   ✅ Added to CURRENT month`);
            }
        }
        // Last month check
        else if (recordYear === lastMonthYear && recordMonth === lastMonth) {
            recordsInLastMonth++;
            addToMonthStats(stats.lastMonth, amount, israelDate, category, organization);
            
            if (recordIndex < 10) {
                console.log(`   📅 Added to LAST month`);
            }
        }
        // Other periods
        else {
            recordsInOtherPeriods++;
            
            if (recordIndex < 10) {
                console.log(`   ⏭️ Skipped (other period)`);
            }
        }
        
        // Current year data
        if (israelDate.getFullYear() === currentYear) {
            stats.yearlyData[currentYear.toString()] += amount;
        }
        
        // Last 12 months - using Israel date
        const monthsDiff = (currentYear - recordYear) * 12 + (currentMonth - recordMonth);
        if (monthsDiff >= 0 && monthsDiff < 12) {
            const year = israelDate.getFullYear();
            const month = (israelDate.getMonth() + 1).toString().padStart(2, '0');
            const monthKey = `${month}-${year}`;
            stats.monthlyData[monthKey] = (stats.monthlyData[monthKey] || 0) + amount;
        }
    });
    
    // Summary for debugging
    console.log('\n📊 Processing Summary:');
    console.log(`   Total records processed: ${validRecords.length}`);
    console.log(`   Records in current month: ${recordsInCurrentMonth}`);
    console.log(`   Records in last month: ${recordsInLastMonth}`);
    console.log(`   Records in other periods: ${recordsInOtherPeriods}`);
    console.log(`   Current month total: ₪${stats.currentMonth.total.toLocaleString('he-IL')}`);
    console.log(`   Last month total: ₪${stats.lastMonth.total.toLocaleString('he-IL')}`);
    console.log(`   Current month daily entries: ${Object.keys(stats.currentMonth.daily).length} days`);
    console.log(`   Current month categories:`, Object.keys(stats.currentMonth.categories));
    console.log(`   Current month organizations:`, Object.keys(stats.currentMonth.organizations));
    
    return stats;
}

function addToMonthStats(monthStats, amount, date, category, organization) {
    monthStats.total += amount;
    
    const dayOfMonth = date.getDate();
    monthStats.daily[dayOfMonth] = (monthStats.daily[dayOfMonth] || 0) + amount;
    
    monthStats.categories[category] = (monthStats.categories[category] || 0) + amount;
    monthStats.organizations[organization] = (monthStats.organizations[organization] || 0) + amount;
    
    const key = `${organization}_${category}`;
    monthStats.categoryOrg[key] = (monthStats.categoryOrg[key] || 0) + amount;
}

// Main function
async function main() {
    try {
        console.log('🚀 Starting daily update process...');
        console.log(`📅 Date: ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`);
        console.log('🌍 Timezone: Asia/Jerusalem\n');
        
        // Validate environment variables
        if (!AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID || !AIRTABLE_API_KEY) {
            throw new Error('Missing required environment variables');
        }
        
        // Fetch all records
        const records = await fetchAllRecords();
        console.log(`📊 Total records fetched: ${records.length}\n`);
        
        // Process data
        const processedData = processData(records);
        
        // Create data directory if it doesn't exist
        const dataDir = path.join(process.cwd(), 'data');
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
        
        // Save to JSON file
        const filePath = path.join(dataDir, 'daily-donations.json');
        await fs.writeFile(filePath, JSON.stringify(processedData, null, 2));
        
        console.log('\n✅ Data saved successfully to:', filePath);
        console.log(`💰 Current month total: ₪${processedData.currentMonth.total.toLocaleString('he-IL')}`);
        console.log(`💰 Last month total: ₪${processedData.lastMonth.total.toLocaleString('he-IL')}`);
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run the script
main();
