// tslint:disable-next-line: ordered-imports
import { sequenceT } from 'fp-ts/lib/Apply'
import * as A from 'fp-ts/lib/Array'
import { identity } from 'fp-ts/lib/function'
import * as O from 'fp-ts/lib/Option'
import { pipe } from 'fp-ts/lib/pipeable'
import * as T from 'fp-ts/lib/Task'
import { copyFileSync, readdirSync } from 'fs'
import { chromium, ElementHandle, Page } from 'playwright'

const data = {
    user: process.env.USER as string,
    password: process.env.PASS as string
}

const selectors = {
    cookieAccept: '#qcCmpButtons > button:nth-child(2)',
    loginLink: '.nav__login a',
    emailInput: '#modal_login > div > div > div.modal_login--body > form > div:nth-child(1) > input',
    passwordInput: '#modal_login > div > div > div.modal_login--body > form > div:nth-child(2) > input',
    loginButton: '#modal_login > div > div > div.modal_login--body > form > button',
    profileLink: '#nav_main > ul > li.nav__profile > a > span.username',
    numberBlock: '.number-block',
    numberTitle: '.number-title',
    numberDownload: '.number-downloads > a:nth-child(1)'
}

type InternazionaleNumber = {
    code: string,
    linkNode: ElementHandle<HTMLOrSVGElement>
}

type InternazionaleDownloaded = InternazionaleNumber
    & {
        path: string
    }

const internazionaleNumber: (
    c: O.Option<string>,
    d: O.Option<InternazionaleNumber['linkNode']>
) => O.Option<InternazionaleNumber> =
    (codeO, linkO) => pipe(
        sequenceT(O.option)(codeO, linkO),
        O.map(
            ([c, l]): InternazionaleNumber => ({ code: c, linkNode: l })
        )
    )

const applyRegexAndGetGroupByIndex = (str: string, regex: RegExp, index: number) => pipe(
    regex.exec(str),
    O.fromNullable,
    O.map(m => m[index])
)

const filterCode: (title: string) => O.Option<string> = title =>
    applyRegexAndGetGroupByIndex(title, /Numero (\d+)/, 1)

const downloadPath = './downloads'
const saveToDownload = (x: InternazionaleDownloaded): InternazionaleDownloaded => {
    const newPath = downloadPath + '/' + x.code + '.pdf'
    copyFileSync(x.path, newPath)

    return {
        ...x,
        path: newPath
    }
}

const downloadInternazionale: (page: Page, item: InternazionaleNumber) => T.Task<O.Option<InternazionaleDownloaded>> =
    (page, int) => pipe(
        () => int.linkNode.click({ delay: 120, force: true }),
        T.chain(() => () => page.waitForEvent('download')),
        T.chain(d => () => d.path()),
        T.map(O.fromNullable),
        T.map(O.map((path): InternazionaleDownloaded => ({ ...int, path: path })))
    );

(async () => {
    const alreadySaved = A.array.chain(
        readdirSync(downloadPath)
            .map(name => applyRegexAndGetGroupByIndex(name, /^(\d+)\.pdf$/, 1)),
        O.fold(() => [], x => [x])
    )

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage({ acceptDownloads: true })
    await page.goto('https://www.internazionale.it')
    await page.waitForSelector(selectors.cookieAccept)
    await page.click(selectors.cookieAccept)

    await page.waitForSelector(selectors.loginLink)
    await page.click(selectors.loginLink)
    await page.waitForSelector(selectors.emailInput, { state: 'visible' })
    await page.waitForSelector(selectors.passwordInput, { state: 'visible' })
    await page.waitForSelector(selectors.loginLink, { state: 'visible' })
    await page.type(selectors.emailInput, data.user)
    await page.type(selectors.passwordInput, data.password)
    await page.click(selectors.loginButton)

    await page.waitForSelector(selectors.profileLink, { state: 'visible' })

    await page.goto('https://utente.internazionale.it/numeri')
    await page.waitForSelector(selectors.numberBlock)

    const elements = await page.$$(selectors.numberBlock)

    const numeri = elements
        .map(e => {

            const code = pipe(
                () => e.$(selectors.numberTitle),
                T.map(O.fromNullable),
                T.chain(O.fold(
                    () => () => Promise.resolve(O.none as O.Option<string>),
                    handler => () => handler.innerText().then(O.fromNullable),
                )),
                T.map(O.chain(filterCode)),
                T.map(O.filter(c => ! alreadySaved.includes(c)))
            )

            const download = pipe(
                () => e.$(selectors.numberDownload),
                T.map(O.fromNullable)
            )

            return pipe(
                sequenceT(T.task)(code, download),
                T.map(args => internazionaleNumber(...args)),
                T.chain(
                    O.fold(
                        () => () => Promise.resolve(O.none as O.Option<InternazionaleDownloaded>),
                        int => downloadInternazionale(page, int)
                    )
                ),
                T.map(
                    O.map(saveToDownload)
                )
            )
        })

    const output = await pipe(
        A.array.traverse(T.taskSeq)(numeri, identity),
        T.map(x => x.map(O.fold(
            () => 'skip',
            d => `${d.path} downloaded`
        )))
    )()

    console.log(output)

    await page.waitForTimeout(1000)
    await browser.close()
})().catch(console.error)