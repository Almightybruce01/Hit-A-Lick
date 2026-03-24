//
//  FirestoreService.swift
//  HitALick
//

import Foundation
import FirebaseAuth
import FirebaseFirestore
import FirebaseCore

/// Saves a signed-in user to Firestore under `/users/{uid}`
func saveUserToFirestore(user: User, username: String, provider: String) {
    guard let _ = FirebaseApp.app(), Auth.auth().app != nil else {
        print("❌ Firebase not ready, skipping Firestore save.")
        return
    }

    let db = Firestore.firestore()
    let userRef = db.collection("users").document(user.uid)

    userRef.setData([
        "email": user.email ?? "",
        "username": username,
        "provider": provider,
        "createdAt": FieldValue.serverTimestamp()
    ], merge: true) { error in
        if let error = error {
            print("❌ Failed to save user to Firestore: \(error.localizedDescription)")
        } else {
            print("✅ User saved to Firestore successfully.")
        }
    }
}
