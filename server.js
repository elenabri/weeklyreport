const express = require('express');
const ExcelJS = require('exceljs');

const app = express();

app.use(
    express.json({
        limit: '1mb'
    })
);


// ============================================================
// НАСТРОЙКИ
// ============================================================

const PORT =
    process.env.PORT || 3000;

const WB_TOKEN =
  'eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYwMzAydjEiLCJ0eXAiOiJKV1QifQ.eyJhY2MiOjMsImVudCI6MSwiZXhwIjoxNzk1ODE3NTIwLCJmb3IiOiJzZWxmIiwiaWQiOiIwMTllNzMzOC0yOTMyLTcyZTQtOWJiMy0wNTQ0OTA3OTdiOTEiLCJpaWQiOjExNzcyNzc0LCJvaWQiOjEyOTk2MSwicyI6ODE2NjIsInNpZCI6IjljYmM3N2U3LWNjMzEtNDgwMC1hMzk2LWYxZmViZjM2MjEyZSIsInQiOmZhbHNlLCJ1aWQiOjExNzcyNzc0fQ.FSug6W66Kdm_ej_1o8lpkDYhSjbTDM2GceayIDb-nocwDXVllJWkb0d89TAXp6_Gz-FyYh4-puiDuAJfpZE6yA';


// ============================================================
// ПРОВЕРКА TOKEN
// ============================================================

function getHeaders() {

    if (!WB_TOKEN) {
        throw new Error(
            'Не задан WB_TOKEN в Environment Variables'
        );
    }

    return {
        Authorization: WB_TOKEN,
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };
}


// ============================================================
// ЧИСЛО
// ============================================================

function num(value) {

    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return 0;
    }

    const n =
        Number(
            String(value)
                .replace(/\s/g, '')
                .replace(',', '.')
        );

    return Number.isFinite(n)
        ? n
        : 0;
}


// ============================================================
// ОКРУГЛЕНИЕ
// ============================================================

function round(value) {

    return Math.round(
        (num(value) + Number.EPSILON) * 100
    ) / 100;
}


// ============================================================
// ДАТА
// ============================================================

function validDate(value) {

    return /^\d{4}-\d{2}-\d{2}$/.test(
        String(value || '')
    );
}


// ============================================================
// WB DETAILED REPORT
//
// НОВЫЙ API:
// POST /api/finance/v1/sales-reports/detailed
//
// Пагинация через rrdId
// ============================================================

async function getDetailedReport(
    dateFrom,
    dateTo
) {

    const result = [];

    let rrdId = 0;

    while (true) {

        const response =
            await fetch(
                'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',
                {
                    method: 'POST',

                    headers:
                        getHeaders(),

                    body:
                        JSON.stringify({
                            dateFrom:
                                `${dateFrom}T00:00:00Z`,

                            dateTo:
                                `${dateTo}T23:59:59Z`,

                            limit:
                                100000,

                            rrdId,

                            period:
                                'weekly'
                        })
                }
            );


        // ------------------------------------------------------
        // 204 = данных больше нет
        // ------------------------------------------------------

        if (
            response.status === 204
        ) {
            break;
        }


        if (!response.ok) {

            const text =
                await response.text();

            throw new Error(
                `WB detailed ${response.status}: ${text}`
            );
        }


        const data =
            await response.json();


        if (
            !Array.isArray(data) ||
            data.length === 0
        ) {
            break;
        }


        result.push(
            ...data
        );


        console.log(
            `DETAILED: +${data.length}; всего ${result.length}`
        );


        const last =
            data[data.length - 1];


        const nextRrdId =
            num(last.rrdId);


        if (
            !nextRrdId ||
            nextRrdId <= rrdId
        ) {
            break;
        }


        rrdId =
            nextRrdId;


        if (
            data.length < 100000
        ) {
            break;
        }
    }


    return result;
}


// ============================================================
// ХРАНЕНИЕ
//
// ОТДЕЛЬНЫЙ ОТЧЁТ
//
// Никакого cache.
// Никакого файла.
// ============================================================

async function getStorageByNmId(
    dateFrom,
    dateTo
) {

    console.log(
        'Получаем отдельный отчёт хранения'
    );


    const createUrl =
        'https://seller-analytics-api.wildberries.ru/api/v1/paid_storage' +
        `?dateFrom=${encodeURIComponent(dateFrom)}` +
        `&dateTo=${encodeURIComponent(dateTo)}`;


    const createResponse =
        await fetch(
            createUrl,
            {
                method: 'GET',

                headers: {
                    Authorization:
                        WB_TOKEN
                }
            }
        );


    const createData =
        await createResponse.json();


    if (!createResponse.ok) {

        throw new Error(
            `STORAGE CREATE ${createResponse.status}: ` +
            JSON.stringify(createData)
        );
    }


    const taskId =
        createData?.data?.taskId;


    if (!taskId) {

        throw new Error(
            'WB не вернул taskId хранения'
        );
    }


    let status =
        '';


    // ----------------------------------------------------------
    // Ждём готовности
    // ----------------------------------------------------------

    for (
        let i = 0;
        i < 60;
        i++
    ) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    5000
                )
        );


        const statusResponse =
            await fetch(
                `https://seller-analytics-api.wildberries.ru/api/v1/paid_storage/tasks/${taskId}/status`,
                {
                    headers: {
                        Authorization:
                            WB_TOKEN
                    }
                }
            );


        const statusData =
            await statusResponse.json();


        if (!statusResponse.ok) {

            throw new Error(
                `STORAGE STATUS ${statusResponse.status}: ` +
                JSON.stringify(statusData)
            );
        }


        status =
            statusData?.data?.status || '';


        console.log(
            'STORAGE STATUS:',
            status
        );


        if (
            status === 'done'
        ) {
            break;
        }


        if (
            status === 'error'
        ) {

            throw new Error(
                'WB ошибка формирования хранения'
            );
        }
    }


    if (
        status !== 'done'
    ) {

        throw new Error(
            'Отчёт хранения не был сформирован'
        );
    }


    // ----------------------------------------------------------
    // Скачиваем отдельный отчёт
    // ----------------------------------------------------------

    const downloadResponse =
        await fetch(
            `https://seller-analytics-api.wildberries.ru/api/v1/paid_storage/tasks/${taskId}/download`,
            {
                headers: {
                    Authorization:
                        WB_TOKEN
                }
            }
        );


    if (!downloadResponse.ok) {

        const text =
            await downloadResponse.text();

        throw new Error(
            `STORAGE DOWNLOAD ${downloadResponse.status}: ${text}`
        );
    }


    const report =
        await downloadResponse.json();


    if (
        !Array.isArray(report)
    ) {

        throw new Error(
            'Неожиданный формат отчёта хранения'
        );
    }


    const storageByNmId =
        {};


    for (
        const row of report
    ) {

        const nmId =
            String(
                row.nmId ||
                row.nm_id ||
                row['nmId'] ||
                ''
            );


        if (!nmId) {
            continue;
        }


        // В текущем отчёте WB
        // ищем сумму хранения
        const amount =
            num(
                row.paidStorage ??
                row['Хранение'] ??
                row.storage ??
                row.amount
            );


        if (!amount) {
            continue;
        }


        storageByNmId[nmId] =
            round(
                num(
                    storageByNmId[nmId]
                ) + amount
            );
    }


    return storageByNmId;
}


// ============================================================
// ПРИЁМКА
//
// В ТВОЁМ ТЕКУЩЕМ КОДЕ:
// reportDetailByPeriod -> acceptance
//
// Поэтому из отдельного paidAcceptance НЕ БЕРЁМ.
// ============================================================

function getAcceptanceByNmId(
    report
) {

    const result =
        {};


    for (
        const row of report
    ) {

        const nmId =
            String(
                row.nmId ||
                row.nm_id ||
                ''
            );


        if (!nmId) {
            continue;
        }


        const amount =
            num(
                row.acceptance
            );


        if (!amount) {
            continue;
        }


        result[nmId] =
            round(
                num(result[nmId]) +
                amount
            );
    }


    return result;
}


// ============================================================
// УДЕРЖАНИЯ
//
// Здесь находится ДЖЕМ.
//
// Только:
//
// supplier_oper_name = Удержание
//
// bonus_type_name содержит "джем"
//
// amount = deduction
// ============================================================

function getWeekDeductions(
    report
) {

    const result = {

        wbPromotionDocs: [],

        transit: 0,

        jam: 0,

        disposal: 0,

        other: 0
    };


    for (
        const row of report
    ) {

        if (
            row.supplier_oper_name !==
            'Удержание'
        ) {
            continue;
        }


        const amount =
            num(
                row.deduction
            );


        if (!amount) {
            continue;
        }


        const text =
            String(
                row.bonus_type_name || ''
            ).toLowerCase();


        // ------------------------------------------------------
        // ДЖЕМ
        // ------------------------------------------------------

        if (
            text.includes('джем')
        ) {

            result.jam +=
                Math.abs(amount);

            continue;
        }


        // ------------------------------------------------------
        // WB ПРОДВИЖЕНИЕ
        // ------------------------------------------------------

        if (
            text.includes(
                'wb продвижение'
            )
        ) {

            const documentMatch =
                text.match(
                    /документ\s*№\s*(\d+)/i
                );


            if (documentMatch) {

                const documentNumber =
                    documentMatch[1];


                const date =
                    String(
                        row.date_to ||
                        row.date_from ||
                        ''
                    ).slice(0, 10);


                result.wbPromotionDocs.push({

                    updNum:
                        Number(
                            documentNumber
                        ),

                    amount:
                        Math.abs(
                            amount
                        ),

                    documentDate:
                        date
                });
            }


            continue;
        }


        // ------------------------------------------------------
        // ТРАНЗИТ
        // ------------------------------------------------------

        if (
            text.includes('транзит')
        ) {

            result.transit +=
                Math.abs(amount);

            continue;
        }


        // ------------------------------------------------------
        // УТИЛИЗАЦИЯ
        // ------------------------------------------------------

        if (
            text.includes(
                'утилизирован'
            )
        ) {

            result.disposal +=
                Math.abs(amount);

            continue;
        }


        result.other +=
            Math.abs(amount);
    }


    result.jam =
        round(result.jam);

    result.transit =
        round(result.transit);

    result.disposal =
        round(result.disposal);

    result.other =
        round(result.other);


    return result;
}


// ============================================================
// WB ПРОДВИЖЕНИЕ
//
// Отдельный рекламный API
// ============================================================

async function getPromotionByArticle(
    dateFrom,
    dateTo,
    report
) {

    const deductions =
        getWeekDeductions(
            report
        );


    const documents =
        deductions.wbPromotionDocs;


    const result =
        {};


    if (
        !documents.length
    ) {
        return result;
    }


    const fromDate =
        new Date(
            `${dateFrom}T00:00:00`
        );


    fromDate.setDate(
        fromDate.getDate() - 1
    );


    const advertDateFrom =
        fromDate
            .toISOString()
            .slice(0, 10);


    for (
        const document
        of documents
    ) {

        if (
            !document.updNum ||
            !document.documentDate
        ) {
            continue;
        }


        const url =
            'https://advert-api.wildberries.ru/adv/v1/upd' +
            `?from=${advertDateFrom}` +
            `&to=${document.documentDate}`;


        const response =
            await fetch(
                url,
                {
                    headers: {
                        Authorization:
                            WB_TOKEN
                    }
                }
            );


        if (!response.ok) {

            console.error(
                'PROMOTION ERROR:',
                response.status
            );

            continue;
        }


        const data =
            await response.json();


        if (
            !Array.isArray(data)
        ) {
            continue;
        }


        // ------------------------------------------------------
        // Оставляем строки нужного документа
        // ------------------------------------------------------

        const rows =
            data.filter(
                row => {

                    const updNum =
                        num(
                            row.updNum ??
                            row.upd_num ??
                            row.documentNumber
                        );

                    return (
                        updNum ===
                        Number(
                            document.updNum
                        )
                    );
                }
            );


        if (!rows.length) {
            continue;
        }


        // ------------------------------------------------------
        // Сумма строк
        // ------------------------------------------------------

        let total =
            0;


        for (
            const row of rows
        ) {

            const nmId =
                String(
                    row.nmId ||
                    row.nm_id ||
                    row.nmID ||
                    ''
                );


            if (!nmId) {
                continue;
            }


            const amount =
                Math.abs(
                    num(
                        row.amount ??
                        row.sum ??
                        row.total
                    )
                );


            if (!amount) {
                continue;
            }


            result[nmId] =
                round(
                    num(result[nmId]) +
                    amount
                );


            total +=
                amount;
        }


        // Если API отдал строки,
        // сумма не должна превышать документ.
        if (
            total >
            document.amount
        ) {

            const ratio =
                document.amount /
                total;


            for (
                const nmId
                of Object.keys(result)
            ) {

                result[nmId] =
                    round(
                        result[nmId] *
                        ratio
                    );
            }
        }
    }


    return result;
}


// ============================================================
// ТРАНЗИТ
//
// Логика сохранена:
// Удержание
// + текст "услуг доставки транзитных поставок"
// + Поставка №...
//
// Затем отдельный API supplies
// ============================================================

async function getTransitByNmId(
    report
) {

    const supplyCosts =
        new Map();


    const result =
        {};


    for (
        const row of report
    ) {

        const operation =
            String(
                row.supplier_oper_name ||
                ''
            ).trim();


        const text =
            String(
                row.bonus_type_name ||
                ''
            ).trim();


        const isTransit =
            operation ===
            'Удержание' &&
            /услуг[аи]? доставки транзитных поставок/i
                .test(text);


        if (!isTransit) {
            continue;
        }


        const match =
            text.match(
                /Поставка\s*№\s*(\d+)/i
            );


        if (!match) {
            continue;
        }


        const supplyId =
            match[1];


        let amount =
            num(
                row['Удержания']
            );


        if (!amount) {

            amount =
                num(
                    row.deduction
                );
        }


        if (!amount) {
            continue;
        }


        amount =
            Math.abs(amount);


        supplyCosts.set(
            supplyId,

            round(
                num(
                    supplyCosts.get(
                        supplyId
                    )
                ) + amount
            )
        );
    }


    // ----------------------------------------------------------
    // Для каждой поставки получаем товары
    // ----------------------------------------------------------

    for (
        const [
            supplyId,
            supplyCost
        ]
        of supplyCosts
    ) {

        const url =
            'https://supplies-api.wildberries.ru/api/v1/supplies/' +
            `${encodeURIComponent(supplyId)}/goods` +
            '?limit=1000&offset=0';


        const response =
            await fetch(
                url,
                {
                    headers: {
                        Authorization:
                            WB_TOKEN
                    }
                }
            );


        if (!response.ok) {
            continue;
        }


        const data =
            await response.json();


        if (
            !Array.isArray(data) ||
            !data.length
        ) {
            continue;
        }


        // ------------------------------------------------------
        // Группируем товары по nmId
        // ------------------------------------------------------

        const goods =
            new Map();


        for (
            const row of data
        ) {

            const nmId =
                String(
                    row.nmId ||
                    row.nm_id ||
                    row.nmID ||
                    ''
                );


            if (!nmId) {
                continue;
            }


            const volume =
                num(
                    row.volume ??
                    row.volumeCm3 ??
                    row.quantity ??
                    1
                );


            goods.set(
                nmId,

                num(
                    goods.get(nmId)
                ) + (
                    volume > 0
                        ? volume
                        : 1
                )
            );
        }


        let totalVolume =
            0;


        for (
            const volume
            of goods.values()
        ) {

            totalVolume +=
                volume;
        }


        if (!totalVolume) {
            continue;
        }


        // ------------------------------------------------------
        // Распределяем стоимость поставки
        // ------------------------------------------------------

        for (
            const [
                nmId,
                volume
            ]
            of goods
        ) {

            const cost =
                supplyCost *
                volume /
                totalVolume;


            result[nmId] =
                round(
                    num(result[nmId]) +
                    cost
                );
        }
    }


    return result;
}


// ============================================================
// УТИЛИЗАЦИЯ
//
// Отдельный документ WB
// ============================================================

async function getDisposalByNmId(
    report
) {

    const documentNumbers =
        new Set();


    // ----------------------------------------------------------
    // Ищем документы утилизации
    // в основном отчёте
    // ----------------------------------------------------------

    for (
        const row of report
    ) {

        const text =
            String(
                row.bonus_type_name ||
                row[
                    'Виды логистики, штрафов и корректировок ВВ'
                ] ||
                ''
            ).trim();


        if (
            !/Отчет об утилизированном товаре/i
                .test(text)
        ) {
            continue;
        }


        const match =
            text.match(
                /документ\s*№\s*(\d+)/i
            );


        if (
            match
        ) {

            documentNumbers.add(
                match[1]
            );
        }
    }


    if (
        !documentNumbers.size
    ) {
        return {};
    }


    // ----------------------------------------------------------
    // Получаем список документов
    // ----------------------------------------------------------

    const listResponse =
        await fetch(
            'https://documents-api.wildberries.ru/api/v1/documents/list?category=disposed-goods-report',
            {
                headers: {
                    Authorization:
                        WB_TOKEN
                }
            }
        );


    if (!listResponse.ok) {

        throw new Error(
            `DISPOSAL LIST ${listResponse.status}`
        );
    }


    const listData =
        await listResponse.json();


    const documents =
        Array.isArray(
            listData?.data?.documents
        )
            ? listData.data.documents
            : Array.isArray(
                listData?.documents
            )
                ? listData.documents
                : Array.isArray(
                    listData
                )
                    ? listData
                    : [];


    const result =
        {};


    // ----------------------------------------------------------
    // Обрабатываем документы
    // ----------------------------------------------------------

    for (
        const document
        of documents
    ) {

        const number =
            String(
                document.number ??
                document.documentNumber ??
                document.id ??
                ''
            );


        if (
            !documentNumbers.has(number)
        ) {
            continue;
        }


        // ------------------------------------------------------
        // В зависимости от ответа WB
        // ищем ссылку / ID документа
        // ------------------------------------------------------

        const documentId =
            document.id ||
            document.documentId ||
            document.number;


        if (!documentId) {
            continue;
        }


        const url =
            `https://documents-api.wildberries.ru/api/v1/documents/${encodeURIComponent(documentId)}`;


        const response =
            await fetch(
                url,
                {
                    headers: {
                        Authorization:
                            WB_TOKEN
                    }
                }
            );


        if (!response.ok) {
            continue;
        }


        const data =
            await response.json();


        const rows =
            Array.isArray(data)
                ? data
                : Array.isArray(data?.data)
                    ? data.data
                    : Array.isArray(data?.data?.rows)
                        ? data.data.rows
                        : [];


        for (
            const row of rows
        ) {

            const nmId =
                String(
                    row.nmId ||
                    row.nm_id ||
                    row.nmID ||
                    ''
                );


            if (!nmId) {
                continue;
            }


            const amount =
                num(
                    row.amount ??
                    row.sum ??
                    row['Сумма'] ??
                    row['Стоимость']
                );


            if (!amount) {
                continue;
            }


            result[nmId] =
                round(
                    num(result[nmId]) +
                    Math.abs(amount)
                );
        }
    }


    return result;
}


// ============================================================
// ОСНОВНОЙ ОТЧЁТ
// ============================================================

app.post(
    '/api/wb-profit-report',
    async (
        req,
        res
    ) => {

        try {

            const {
                dateFrom,
                dateTo
            } =
                req.body || {};


            // --------------------------------------------------
            // Проверяем даты
            // --------------------------------------------------

            if (
                !validDate(dateFrom) ||
                !validDate(dateTo)
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        'Дата должна быть в формате YYYY-MM-DD'
                });
            }


            if (
                dateFrom > dateTo
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        'dateFrom не может быть больше dateTo'
                });
            }


            if (!WB_TOKEN) {

                return res.status(500).json({
                    success: false,
                    error:
                        'Не задан WB_TOKEN'
                });
            }


            console.log('');
            console.log(
                '=========================================='
            );
            console.log(
                'WB PROFIT REPORT'
            );
            console.log(
                dateFrom,
                '->',
                dateTo
            );
            console.log(
                '=========================================='
            );


            // ==================================================
            // 1. ОСНОВНОЙ DETAILED REPORT
            // ==================================================

            const report =
                await getDetailedReport(
                    dateFrom,
                    dateTo
                );


            console.log(
                'DETAILED ROWS:',
                report.length
            );


            // ==================================================
            // 2. ОТДЕЛЬНЫЕ ОТЧЁТЫ
            //
            // Каждый источник получает свои данные.
            // ==================================================

            const [
                storageByNmId,
                promotionByNmId,
                transitByNmId,
                disposalByNmId
            ] =
                await Promise.all([
                    getStorageByNmId(
                        dateFrom,
                        dateTo
                    ),

                    getPromotionByArticle(
                        dateFrom,
                        dateTo,
                        report
                    ),

                    getTransitByNmId(
                        report
                    ),

                    getDisposalByNmId(
                        report
                    )
                ]);


            const acceptanceByNmId =
                getAcceptanceByNmId(
                    report
                );


            const deductions =
                getWeekDeductions(
                    report
                );


            // ==================================================
            // 3. ТОВАРЫ
            // ==================================================

            const products =
                new Map();


            function getProduct(
                nmId,
                row
            ) {

                if (
                    !products.has(nmId)
                ) {

                    products.set(
                        nmId,
                        {
                            nmId,

                            vendorCode:
                                row.vendorCode ||
                                row.supplierArticle ||
                                '',

                            sku:
                                row.sku ||
                                '',

                            title:
                                row.title ||
                                '',

                            retailPrice:
                                0,

                            sales:
                                0,

                            quantity:
                                0,

                            forPay:
                                0,

                            logistics:
                                0,

                            storage:
                                0,

                            acceptance:
                                0,

                            promotion:
                                0,

                            transit:
                                0,

                            penalty:
                                0,

                            disposal:
                                0,

                            commission:
                                0,

                            tax:
                                0,

                            profit:
                                0
                        }
                    );
                }


                return products.get(
                    nmId
                );
            }


            // ==================================================
            // 4. ОСНОВНОЙ DETAILED
            //
            // Продажи
            // Возвраты
            // К перечислению
            // Логистика
            // Штрафы
            // ==================================================

            for (
                const row
                of report
            ) {

                const nmId =
                    String(
                        row.nmId || ''
                    );


                if (!nmId) {
                    continue;
                }


                const product =
                    getProduct(
                        nmId,
                        row
                    );


                const operation =
                    String(
                        row.sellerOperName ||
                        row.supplier_oper_name ||
                        ''
                    ).trim();


                // ------------------------------------------------
                // ПРОДАЖА
                // ------------------------------------------------

                if (
                    operation ===
                        'Продажа' ||
                    operation ===
                        'Продажа товара'
                ) {

                    const quantity =
                        num(
                            row.quantity
                        );


                    product.sales +=
                        num(
                            row.retailAmount
                        );


                    product.quantity +=
                        quantity;


                    product.forPay +=
                        num(
                            row.forPay
                        );


                    product.retailPrice +=
                        num(
                            row.retailPrice
                        ) *
                        quantity;
                }


                // ------------------------------------------------
                // ВОЗВРАТ
                // ------------------------------------------------

                if (
                    operation ===
                        'Возврат' ||
                    operation ===
                        'Возврат товара'
                ) {

                    const quantity =
                        num(
                            row.quantity
                        );


                    product.sales -=
                        num(
                            row.retailAmount
                        );


                    product.quantity -=
                        quantity;


                    product.forPay -=
                        num(
                            row.forPay
                        );


                    product.retailPrice -=
                        num(
                            row.retailPrice
                        ) *
                        quantity;
                }


                // ------------------------------------------------
                // ЛОГИСТИКА
                //
                // Из основного detailed
                // ------------------------------------------------

                product.logistics +=
                    num(
                        row.deliveryService
                    );


                // ------------------------------------------------
                // ШТРАФ
                // ------------------------------------------------

                product.penalty +=
                    Math.abs(
                        num(
                            row.penalty
                        )
                    );
            }


            // ==================================================
            // 5. ДОБАВЛЯЕМ ОТДЕЛЬНЫЕ ОТЧЁТЫ
            // ==================================================

            for (
                const [
                    nmId,
                    value
                ]
                of Object.entries(
                    storageByNmId
                )
            ) {

                const product =
                    getProduct(
                        nmId,
                        {
                            vendorCode: '',
                            sku: '',
                            title: ''
                        }
                    );


                product.storage +=
                    value;
            }


            for (
                const [
                    nmId,
                    value
                ]
                of Object.entries(
                    acceptanceByNmId
                )
            ) {

                const product =
                    getProduct(
                        nmId,
                        {
                            vendorCode: '',
                            sku: '',
                            title: ''
                        }
                    );


                product.acceptance +=
                    value;
            }


            for (
                const [
                    nmId,
                    value
                ]
                of Object.entries(
                    promotionByNmId
                )
            ) {

                const product =
                    getProduct(
                        nmId,
                        {
                            vendorCode: '',
                            sku: '',
                            title: ''
                        }
                    );


                product.promotion +=
                    value;
            }


            for (
                const [
                    nmId,
                    value
                ]
                of Object.entries(
                    transitByNmId
                )
            ) {

                const product =
                    getProduct(
                        nmId,
                        {
                            vendorCode: '',
                            sku: '',
                            title: ''
                        }
                    );


                product.transit +=
                    value;
            }


            for (
                const [
                    nmId,
                    value
                ]
                of Object.entries(
                    disposalByNmId
                )
            ) {

                const product =
                    getProduct(
                        nmId,
                        {
                            vendorCode: '',
                            sku: '',
                            title: ''
                        }
                    );


                product.disposal +=
                    value;
            }


            // ==================================================
            // 6. ОБЫЧНЫЕ ТОВАРЫ
            // ==================================================

            const rows =
                [];


            for (
                const product
                of products.values()
            ) {

                const salesForTax =
                    Math.max(
                        0,
                        product.sales
                    );


                const taxPart1 =
                    salesForTax /
                    105 *
                    5;


                const taxPart2 =
                    (
                        salesForTax -
                        taxPart1
                    ) *
                    0.02;


                product.tax =
                    taxPart1 +
                    taxPart2;


                product.commission =
                    product.retailPrice
                    - product.forPay
                    + product.tax
                    + product.logistics
                    + product.storage
                    + product.acceptance
                    + product.promotion
                    + product.transit
                    + product.penalty
                    + product.disposal;


                product.profit =
                    product.forPay
                    - product.logistics
                    - product.storage
                    - product.acceptance
                    - product.promotion
                    - product.transit
                    - product.disposal
                    - product.penalty;


                rows.push(
                    product
                );
            }


            // ==================================================
            // 7. ДЖЕМ
            //
            // ОТДЕЛЬНЫЙ ТОВАР
            //
            // НЕ распределяется.
            // НЕ меняет обычные товары.
            //
            // Продажа = 0
            // Количество = 1
            // Цена = 0
            // Комиссия = deductions.jam
            // ==================================================

            const jamAmount =
                round(
                    deductions.jam
                );


            if (
                jamAmount !== 0
            ) {

                rows.push({

                    nmId:
                        'jam',

                    vendorCode:
                        'jam',

                    sku:
                        '',

                    title:
                        'Джем',

                    retailPrice:
                        0,

                    sales:
                        0,

                    quantity:
                        1,

                    forPay:
                        0,

                    logistics:
                        0,

                    storage:
                        0,

                    acceptance:
                        0,

                    promotion:
                        0,

                    transit:
                        0,

                    penalty:
                        0,

                    disposal:
                        0,

                    commission:
                        jamAmount,

                    tax:
                        0,

                    profit:
                        0
                });
            }


            // ==================================================
            // 8. ОКРУГЛЕНИЕ
            // ==================================================

            for (
                const row
                of rows
            ) {

                row.retailPrice =
                    round(
                        row.retailPrice
                    );

                row.sales =
                    round(
                        row.sales
                    );

                row.quantity =
                    round(
                        row.quantity
                    );

                row.forPay =
                    round(
                        row.forPay
                    );

                row.logistics =
                    round(
                        row.logistics
                    );

                row.storage =
                    round(
                        row.storage
                    );

                row.acceptance =
                    round(
                        row.acceptance
                    );

                row.promotion =
                    round(
                        row.promotion
                    );

                row.transit =
                    round(
                        row.transit
                    );

                row.penalty =
                    round(
                        row.penalty
                    );

                row.disposal =
                    round(
                        row.disposal
                    );

                row.commission =
                    round(
                        row.commission
                    );

                row.tax =
                    round(
                        row.tax
                    );

                row.profit =
                    round(
                        row.profit
                    );
            }


            // ==================================================
            // 9. СОРТИРОВКА
            //
            // Джем внизу, обычные товары по прибыли.
            // ==================================================

            rows.sort(
                (a, b) => {

                    if (
                        a.nmId === 'jam'
                    ) {
                        return 1;
                    }

                    if (
                        b.nmId === 'jam'
                    ) {
                        return -1;
                    }

                    return (
                        b.profit -
                        a.profit
                    );
                }
            );


            // ==================================================
            // 10. EXCEL
            // ==================================================

            const workbook =
                new ExcelJS.Workbook();


            workbook.creator =
                'WB Profit Report';


            const sheet =
                workbook.addWorksheet(
                    'Profit'
                );


            sheet.columns = [

                {
                    header:
                        'nmId',

                    key:
                        'nmId',

                    width:
                        16
                },

                {
                    header:
                        'Артикул',

                    key:
                        'vendorCode',

                    width:
                        25
                },

                {
                    header:
                        'ШК',

                    key:
                        'sku',

                    width:
                        22
                },

                {
                    header:
                        'Название товара',

                    key:
                        'title',

                    width:
                        45
                },

                {
                    header:
                        'Цена розничная',

                    key:
                        'retailPrice',

                    width:
                        18
                },

                {
                    header:
                        'Продажа',

                    key:
                        'sales',

                    width:
                        18
                },

                {
                    header:
                        'Налог',

                    key:
                        'tax',

                    width:
                        15
                },

                {
                    header:
                        'Кол-во',

                    key:
                        'quantity',

                    width:
                        12
                },

                {
                    header:
                        'К перечислению',

                    key:
                        'forPay',

                    width:
                        18
                },

                {
                    header:
                        'Логистика',

                    key:
                        'logistics',

                    width:
                        18
                },

                {
                    header:
                        'Хранение',

                    key:
                        'storage',

                    width:
                        18
                },

                {
                    header:
                        'Приемка',

                    key:
                        'acceptance',

                    width:
                        18
                },

                {
                    header:
                        'WB Продвижение',

                    key:
                        'promotion',

                    width:
                        20
                },

                {
                    header:
                        'Транзит',

                    key:
                        'transit',

                    width:
                        15
                },

                {
                    header:
                        'Штрафы',

                    key:
                        'penalty',

                    width:
                        15
                },

                {
                    header:
                        'Утилизация',

                    key:
                        'disposal',

                    width:
                        18
                },

                {
                    header:
                        'Комиссия',

                    key:
                        'commission',

                    width:
                        18
                },

                {
                    header:
                        'Итого к оплате',

                    key:
                        'profit',

                    width:
                        20
                }
            ];


            for (
                const row
                of rows
            ) {

                sheet.addRow(
                    row
                );
            }


            // ==================================================
            // 11. ФОРМАТИРОВАНИЕ
            // ==================================================

            sheet.getRow(1).font = {
                bold: true
            };


            sheet.getRow(1).alignment = {
                vertical:
                    'middle',

                horizontal:
                    'center'
            };


            sheet.views = [
                {
                    state:
                        'frozen',

                    ySplit:
                        1
                }
            ];


            const moneyColumns = [
                5,
                6,
                7,
                9,
                10,
                11,
                12,
                13,
                14,
                15,
                16,
                17,
                18
            ];


            for (
                let rowNumber = 2;
                rowNumber <=
                    sheet.rowCount;
                rowNumber++
            ) {

                for (
                    const column
                    of moneyColumns
                ) {

                    sheet
                        .getCell(
                            rowNumber,
                            column
                        )
                        .numFmt =
                        '#,##0.00';
                }


                sheet
                    .getCell(
                        rowNumber,
                        8
                    )
                    .numFmt =
                    '#,##0';
            }


            // ==================================================
            // 12. ОТДАЁМ EXCEL
            // ==================================================

            const buffer =
                await workbook.xlsx.writeBuffer();


            const filename =
                `profit-report-${dateFrom}-${dateTo}.xlsx`;


            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );


            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename}"`
            );


            res.setHeader(
                'Content-Length',
                buffer.length
            );


            return res
                .status(200)
                .send(buffer);

        } catch (error) {

            console.error(
                'WB REPORT ERROR:',
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    error.message ||
                    'Ошибка формирования отчёта'
            });
        }
    }
);


// ============================================================
// INDEX.HTML
// ============================================================

app.get(
    '/',
    (req, res) => {

        res.sendFile(
            require('path').join(
                __dirname,
                'index.html'
            )
        );
    }
);


// ============================================================
// VERCEL / LOCAL
// ============================================================

if (
    require.main === module
) {

    app.listen(
        PORT,
        () => {

            console.log(
                `Server started on port ${PORT}`
            );
        }
    );
}


module.exports =
    app;
