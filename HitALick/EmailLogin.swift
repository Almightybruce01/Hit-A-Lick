//
//  EmailLogin.swift
//  HitALick
//
//  Created by Brian Bruce on 2025-06-11.
//

import SwiftUI
import FirebaseAuth

struct EmailLogin: View {
    @State private var email = ""
    @State private var password = ""
    @State private var message = ""
    @AppStorage("isUserLoggedIn") var isUserLoggedIn: Bool = false
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Email Login").font(.title)

            TextField("Email", text: $email)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .keyboardType(.emailAddress)

            SecureField("Password", text: $password)
                .textFieldStyle(RoundedBorderTextFieldStyle())

            Button("Sign In") {
                Auth.auth().signIn(withEmail: email, password: password) { result, error in
                    if let user = result?.user {
                        message = "✅ Logged in: \(user.uid)"
                        
                        isUserLoggedIn = true  // ✅ This makes ContentView switch to HomeScreen
                        
                    } else {
                        message = error?.localizedDescription ?? "Sign in failed"
                    }
                }
            }

            Button("Create Account") {
                Auth.auth().createUser(withEmail: email, password: password) { result, error in
                    if let user = result?.user {
                        message = "✅ Account created: \(user.uid)"
                        
                        isUserLoggedIn = true  // ✅ This makes ContentView switch to HomeScreen
                        
                    } else {
                        message = error?.localizedDescription ?? "Account creation failed"
                    }
                }
            }

            Text(message).foregroundColor(.blue)
        }
        .padding()
    }
}
