//
//  AppleLogin.swift
//  HitALick
//

import SwiftUI
import AuthenticationServices
import FirebaseAuth
import FirebaseFirestore
import CryptoKit
import Foundation

struct AppleLogin: View {
    @State private var currentNonce: String?
    @State private var username: String = ""
    @AppStorage("isUserLoggedIn") var isUserLoggedIn: Bool = false
    
    var body: some View {
        VStack(spacing: 16) {
            TextField("Create a username", text: $username)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .padding()

            SignInWithAppleButton(.signIn,
                onRequest: { request in
                    let nonce = randomNonceString()
                    currentNonce = nonce
                    request.requestedScopes = [.email, .fullName]
                    request.nonce = sha256(nonce)
                },
                onCompletion: { result in
                    switch result {
                    case .success(let authResults):
                        handleAppleIDCredential(authResults)
                    case .failure(let error):
                        print("❌ Apple Sign-In error: \(error.localizedDescription)")
                    }
                })
            .frame(width: 280, height: 45)
            .signInWithAppleButtonStyle(.black)
        }
    }

    func handleAppleIDCredential(_ authResults: ASAuthorization) {
        guard let appleIDCredential = authResults.credential as? ASAuthorizationAppleIDCredential,
              let identityToken = appleIDCredential.identityToken,
              let tokenString = String(data: identityToken, encoding: .utf8),
              let nonce = currentNonce else {
            print("❌ Missing Apple credentials or nonce")
            return
        }

        let credential = OAuthProvider.credential(withProviderID: "apple.com", idToken: tokenString, rawNonce: nonce)

        Auth.auth().signIn(with: credential) { authResult, error in
            if let user = authResult?.user {
                saveUserToFirestore(user: user, username: username, provider: "apple")
                
                isUserLoggedIn = true  // ✅ This makes ContentView switch to HomeScreen
                
            } else {
                print("❌ Firebase Auth error: \(error?.localizedDescription ?? "Unknown")")
            }
        }
    }
}

// MARK: - 🔐 Nonce Generator

private func randomNonceString(length: Int = 32) -> String {
    let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    var result = ""
    var remainingLength = length

    while remainingLength > 0 {
        var random: UInt8 = 0
        let errorCode = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
        if errorCode != errSecSuccess {
            fatalError("❌ Unable to generate nonce.")
        }

        if random < charset.count {
            result.append(charset[Int(random)])
            remainingLength -= 1
        }
    }

    return result
}

private func sha256(_ input: String) -> String {
    let inputData = Data(input.utf8)
    let hashed = SHA256.hash(data: inputData)
    return hashed.map { String(format: "%02x", $0) }.joined()
}
