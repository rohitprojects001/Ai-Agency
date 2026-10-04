import AppKit
import PDFKit
import WebKit

final class GuideRenderer: NSObject, WKNavigationDelegate {
    private let application = NSApplication.shared
    private let pageWidth: CGFloat = 595
    private let pageHeight: CGFloat = 842
    private lazy var webView = WKWebView(frame: NSRect(x: 0, y: 0, width: pageWidth, height: pageHeight))
    private let outputURL: URL
    private let accessDirectory: URL
    private var renderedPages: [Data] = []
    private var sections: [(top: CGFloat, height: CGFloat)] = []
    private var sectionIndex = 0
    private var offsetWithinSection: CGFloat = 0

    init(outputURL: URL, accessDirectory: URL) {
        self.outputURL = outputURL
        self.accessDirectory = accessDirectory
        super.init()
        application.setActivationPolicy(.accessory)
        webView.navigationDelegate = self
    }

    func render(_ htmlURL: URL) {
        webView.loadFileURL(htmlURL, allowingReadAccessTo: accessDirectory)
        application.run()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            webView.evaluateJavaScript("JSON.stringify(Array.from(document.querySelectorAll('.cover, .page')).map(element => ({top: element.getBoundingClientRect().top + window.scrollY, height: element.getBoundingClientRect().height})))") { result, error in
                guard error == nil, let json = result as? String,
                      let data = json.data(using: .utf8),
                      let values = try? JSONSerialization.jsonObject(with: data) as? [[String: Double]] else {
                    fputs("Could not measure the guide pages: \(error?.localizedDescription ?? "unknown error")\n", stderr)
                    self.application.terminate(nil)
                    return
                }
                self.sections = values.compactMap { value in
                    guard let top = value["top"], let height = value["height"] else { return nil }
                    return (CGFloat(top), CGFloat(height))
                }
                self.renderNextPage()
            }
        }
    }

    private func renderNextPage() {
        while sectionIndex < sections.count && offsetWithinSection >= sections[sectionIndex].height {
            sectionIndex += 1
            offsetWithinSection = 0
        }
        guard sectionIndex < sections.count else {
            do {
                let combined = PDFDocument()
                for pageData in renderedPages {
                    guard let source = PDFDocument(data: pageData), let page = source.page(at: 0) else {
                        throw NSError(domain: "GuidePDF", code: 1, userInfo: [NSLocalizedDescriptionKey: "A rendered page could not be opened"])
                    }
                    combined.insert(page, at: combined.pageCount)
                }
                guard let data = combined.dataRepresentation() else {
                    throw NSError(domain: "GuidePDF", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not combine the rendered pages"])
                }
                try data.write(to: outputURL)
            } catch {
                fputs("Could not write the guide PDF: \(error.localizedDescription)\n", stderr)
            }
            application.terminate(nil)
            return
        }

        let configuration = WKPDFConfiguration()
        let section = sections[sectionIndex]
        let remaining = section.height - offsetWithinSection
        let height = min(pageHeight, remaining)
        configuration.rect = CGRect(
            x: 0,
            y: section.top + offsetWithinSection,
            width: pageWidth,
            height: height
        )
        webView.createPDF(configuration: configuration) { result in
            switch result {
            case .success(let data):
                self.renderedPages.append(data)
                self.offsetWithinSection += height
                self.renderNextPage()
            case .failure(let error):
                fputs("Could not render the guide PDF: \(error.localizedDescription)\n", stderr)
                self.application.terminate(nil)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("Could not render the guide HTML: \(error.localizedDescription)\n", stderr)
        application.terminate(nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("Could not load the guide HTML: \(error.localizedDescription)\n", stderr)
        application.terminate(nil)
    }
}

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: swift generate-guide-pdf.swift input.html output.pdf\n", stderr)
    exit(2)
}

let htmlURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let renderer = GuideRenderer(outputURL: outputURL, accessDirectory: URL(fileURLWithPath: "/"))
renderer.render(htmlURL)
