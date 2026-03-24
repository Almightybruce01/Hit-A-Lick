//
//  GmailLogin.swift
//  HitALick
//

import SwiftUI
import FirebaseAuth
import FirebaseFirestore
import GoogleSignIn
import GoogleSignInSwift
import Foundation

struct GmailLogin: View {
    @State private var username: String = ""
    @AppStorage("isUserLoggedIn") var isUserLoggedIn: Bool = false
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Sign in with Google")
                .font(.title2)

            TextField("Create a username", text: $username)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .padding(.horizontal)

            GoogleSignInButton(action: handleGoogleSignIn)
                .frame(width: 280, height: 45)
        }
        .padding()
    }

    func handleGoogleSignIn() {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootViewController = windowScene.windows.first?.rootViewController else {
            print("❌ Could not find root view controller.")
            return
        }

        GIDSignIn.sharedInstance.signIn(withPresenting: rootViewController) { result, error in
            guard error == nil,
                  let user = result?.user,
                  let idToken = user.idToken?.tokenString else {
                print("❌ Google sign-in failed.")
                return
            }

            let accessToken = user.accessToken.tokenString

            let credential = GoogleAuthProvider.credential(
                withIDToken: idToken,
                accessToken: accessToken
            )

            Auth.auth().signIn(with: credential) { authResult, error in
                if let user = authResult?.user {
                    saveUserToFirestore(user: user, username: username, provider: "google")
                   
                    
                    isUserLoggedIn = true  // ✅ This makes ContentView switch to HomeScreen
                    
                    
                } else {
                    print("❌ Firebase login error: \(error?.localizedDescription ?? "Unknown")")
                }
            }
        }
    }
}
