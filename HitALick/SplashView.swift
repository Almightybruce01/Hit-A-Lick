//
//  SplashView.swift
//  HitALick
//
//  Created by Brian Bruce on 2025-06-26.
//

import SwiftUI

struct SplashView: View {
    @State private var isActive = false
    @State private var rotation: Double = 0

    var body: some View {
        if isActive {
            ContentView() // ⬅️ Main app starts here
        } else {
            ZStack {
                Color.black.ignoresSafeArea()

                VStack {
                    Image("HitALicklogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 200, height: 200)
                        .rotationEffect(.degrees(rotation))
                        .onAppear {
                            animateSpin()
                        }

                    Text("RESEARCH. ANALYZE. EXECUTE.")
                        .foregroundColor(.white)
                        .font(.caption)
                        .padding(.top, 8)
                }
            }
        }
    }

    func animateSpin() {
        let fastSpinDuration = 2.0
        let stopDuration = 0.5

        // Spin quickly
        withAnimation(Animation.linear(duration: fastSpinDuration)) {
            rotation = 360 * 8 // 8 full spins
        }

        // Wait, then stop spinning for 0.5s, then go to ContentView
        DispatchQueue.main.asyncAfter(deadline: .now() + fastSpinDuration + stopDuration) {
            isActive = true
        }
    }
}
