//
//  Gifview.swift
//  Hit-A-Lick
//
//  Created by Brian Bruce on 2025-05-15.
//

import SwiftUI
import WebKit

struct GifImage: UIViewRepresentable {
    private let name: String
    
    init(_ name: String) {
        self.name = name
    }
    
    func makeUIView(context: Context) -> WKWebView {
        let WebView = WKWebView()
        guard let url = Bundle.main.url(forResource: name, withExtension: "GIF") else {
            fatalError("ERROR: GIF file '\(name).Gif' not found in main bundle.")
        }

        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            fatalError("ERROR: Could not load data for '\(name).GIF': \(error)")
        }
        
        WebView.load(
            data,
            mimeType: "image/GIF",
            characterEncodingName: "UTF-8",
            baseURL: url.deletingLastPathComponent()
        )
           
        return WebView
        
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context){
        uiView.reload()
    }
}

struct GifImage_Previews: PreviewProvider {
    static var previews: some View {
        GifImage("spacebackground2")
    }
}
