// ============================================================
// DOLAN SAWAH AI
// RECIPE ENGINE
// ============================================================

import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc
} from "firebase/firestore";

import { db } from "./firebase";

import {
  COLLECTIONS,
  createRecipe
} from "./dataModel";

// ============================================================
// GET ALL RECIPES
// ============================================================

export async function getRecipes() {
  const snapshot = await getDocs(
    collection(db, COLLECTIONS.RECIPES)
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

// ============================================================
// SAVE RECIPE
// ============================================================

export async function saveRecipe(data) {
  if (!data.menuName) {
    throw new Error(
      "Nama menu wajib diisi."
    );
  }

  if (
    !Array.isArray(data.ingredients) ||
    data.ingredients.length === 0
  ) {
    throw new Error(
      "Resep harus memiliki minimal satu bahan."
    );
  }

  const recipe =
    createRecipe(data);

  const ref = collection(
    db,
    COLLECTIONS.RECIPES
  );

  const docRef =
    await addDoc(ref, recipe);

  return {
    id: docRef.id,
    ...recipe
  };
}

// ============================================================
// UPDATE RECIPE
// ============================================================

export async function updateRecipe(id, data) {
  if (!id) {
    throw new Error(
      "ID resep tidak valid."
    );
  }

  if (!data.menuName) {
    throw new Error(
      "Nama menu wajib diisi."
    );
  }

  if (
    !Array.isArray(data.ingredients) ||
    data.ingredients.length === 0
  ) {
    throw new Error(
      "Resep harus memiliki minimal satu bahan."
    );
  }

  const payload = {
    menuName: data.menuName,
    ingredients: data.ingredients,
    portions: Number(data.portions || 1),
    sellPrice: Number(data.sellPrice || 0),
    updatedAt: new Date().toISOString()
  };

  await updateDoc(
    doc(db, COLLECTIONS.RECIPES, id),
    payload
  );

  return {
    id,
    ...payload
  };
}

// ============================================================
// DELETE RECIPE
// ============================================================

export async function deleteRecipe(id) {
  if (!id) {
    throw new Error(
      "ID resep tidak valid."
    );
  }

  await deleteDoc(
    doc(db, COLLECTIONS.RECIPES, id)
  );
}

// ============================================================
// CALCULATE USAGE FROM SALES
// ============================================================

export function calculateUsageFromSales(
  sales,
  recipes
) {
  const usageMap = {};

  for (const sale of sales) {
    const menuName =
      String(
        sale.menuName || ""
      )
        .trim()
        .toLowerCase();

    const recipe =
      recipes.find(
        (r) =>
          String(
            r.menuName || ""
          )
            .trim()
            .toLowerCase() ===
          menuName
      );

    if (!recipe) {
      continue;
    }

    const portions =
      Number(
        sale.quantity || 0
      );

    for (
      const ingredient
      of recipe.ingredients
    ) {
      const key =
        ingredient.itemId ||
        ingredient.itemName;

      if (!usageMap[key]) {
        usageMap[key] = {
          itemId:
            ingredient.itemId || "",

          itemName:
            ingredient.itemName || "",

          unit:
            ingredient.unit || "",

          quantity: 0,

          sourceMenus: []
        };
      }

      const usage =
        Number(
          ingredient.quantity || 0
        ) * portions;

      usageMap[key].quantity +=
        usage;

      if (
        !usageMap[key].sourceMenus.includes(
          sale.menuName
        )
      ) {
        usageMap[key].sourceMenus.push(
          sale.menuName
        );
      }
    }
  }

  return Object.values(
    usageMap
  );
}

