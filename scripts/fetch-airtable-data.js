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

// Process the raw data
function processData(records) {
    console.log('⚙️ Processing data...');
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    
    const currentMonthStart = new Date(currentYear, currentMonth, 1);
    const lastMonthStart = new Date(lastMonthYear, lastMonth, 1);
    const lastMonthEnd = new Date(lastMonthYear, lastMonth + 1, 0);
    const yearStart = new Date(currentYear, 0, 1);
    const last12MonthsStart = new Date(currentYear, currentMonth - 11, 1);
    
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
    
    validRecords.forEach((record) => {
        const fields = record.fields;
        const amount = parseFloat(fields[amountField]);
        const dateStr = fields[dateField];
        
        let date;
        try {
            date = new Date(dateStr);
            if (isNaN(date.getTime())) return;
        } catch (e) {
            return;
        }
        
        const category = fields[categoryField] || 'לא מוגדר';
        const organization = fields[orgField] || 'אחר';
        
        // Current month
        if (date >= currentMonthStart) {
            addToMonthStats(stats.currentMonth, amount, date, category, organization);
        }
        
        // Last month
        if (date >= lastMonthStart && date <= lastMonthEnd) {
            addToMonthStats(stats.lastMonth, amount, date, category, organization);
        }
        
        // Current year data
        if (date >= yearStart) {
            stats.yearlyData['2025'] += amount;
        }
        
        // Last 12 months
        if (date >= last12MonthsStart) {
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const monthKey = `${month}-${year}`;
            stats.monthlyData[monthKey] = (stats.monthlyData[monthKey] || 0) + amount;
        }
    });
    
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
        
        // Validate environment variables
        if (!AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID || !AIRTABLE_API_KEY) {
            throw new Error('Missing required environment variables');
        }
        
        // Fetch all records
        const records = await fetchAllRecords();
        console.log(`📊 Total records fetched: ${records.length}`);
        
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
        
        console.log('✅ Data saved successfully to:', filePath);
        console.log(`💰 Current month total: ₪${processedData.currentMonth.total.toLocaleString('he-IL')}`);
        console.log(`💰 Last month total: ₪${processedData.lastMonth.total.toLocaleString('he-IL')}`);
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run the script
main();
